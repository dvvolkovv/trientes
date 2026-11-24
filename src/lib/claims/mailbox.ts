/**
 * Чтение ящика, на который проекты пишут «это наш проект» (слайс CI).
 *
 * Ящик задаётся ключами в `.env`; нет ключей — прогон не ходит никуда, а
 * двери «напишите нам» на страницах объектов не появляется вовсе: инструкция
 * без чтения ящика ведёт в тишину (правило слайса AV).
 *
 * Прочитанное письмо помечается `\Seen` и переносится в `Archive`: ящик —
 * очередь, а не склад, и человек, открывший его глазами, должен видеть только
 * то, с чем мы ещё не разобрались. Перенос не удался — письмо всё равно
 * прочитано, и второй раз заявки не заведёт (`Message-ID` уникален).
 */

import { ImapFlow } from "imapflow";
import { decodeHeaderWords, extractText, MAX_BODY_CHARS } from "@/lib/claims/mime";

export type ClaimMailboxConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** Адрес, который мы публикуем на сайте; по умолчанию — имя входа. */
  address: string;
  /** Имя нашего почтового сервера для разбора `Authentication-Results`. */
  authServer: string;
};

export type InboundMessage = {
  uid: number;
  messageId: string;
  from: string;
  to: string | null;
  subject: string | null;
  bodyText: string | null;
  /** Все `Authentication-Results` сверху вниз, как в письме. */
  authResults: string[];
  receivedAt: Date;
};

/** За один прогон читаем не больше: ящик — не место для обхода тысяч писем. */
export const MAX_FETCH = 50;
const TIMEOUT_MS = 20_000;

/**
 * Настройки ящика из окружения. Отдельные ключи, а не `SMTP_*`: ящик для
 * входящих и ящик, с которого мы шлём, — разные ящики, и однажды это станет
 * видно (`noreply@` писем не принимает по смыслу своего имени).
 */
export function mailboxConfig(env: NodeJS.ProcessEnv = process.env): ClaimMailboxConfig | null {
  const host = (env.CLAIM_IMAP_HOST ?? "").trim();
  const user = (env.CLAIM_IMAP_USER ?? "").trim();
  const pass = env.CLAIM_IMAP_PASS ?? "";
  if (host === "" || user === "" || pass === "") return null;
  const port = Number((env.CLAIM_IMAP_PORT ?? "993").trim());
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 993,
    user,
    pass,
    address: (env.CLAIM_INBOX_ADDRESS ?? user).trim().toLowerCase(),
    authServer: (env.CLAIM_AUTH_SERVER ?? env.SMTP_HOST ?? host).trim(),
  };
}

/** Публичный адрес ящика для страниц; null — читать нечем, двери нет. */
export function claimInboxAddress(env: NodeJS.ProcessEnv = process.env): string | null {
  return mailboxConfig(env)?.address ?? null;
}

type HeaderMap = Map<string, string[]>;

/**
 * Заголовки письма из сырого куска: имя → значения в порядке появления.
 * Продолжения строк склеиваются — `Authentication-Results` почти всегда
 * приходит разбитым на несколько строк.
 */
export function parseHeaders(raw: string): HeaderMap {
  const out: HeaderMap = new Map();
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let name: string | null = null;
  let value = "";
  const flush = () => {
    if (name === null) return;
    const key = name.toLowerCase();
    const list = out.get(key) ?? [];
    list.push(value.trim());
    out.set(key, list);
    name = null;
    value = "";
  };
  for (const line of lines) {
    if (line === "") break;
    if (/^[ \t]/.test(line) && name !== null) {
      value += ` ${line.trim()}`;
      continue;
    }
    const m = /^([!-9;-~]+):(.*)$/.exec(line);
    if (m === null) continue;
    flush();
    name = m[1];
    value = m[2];
  }
  flush();
  return out;
}

/** Первое значение заголовка или null. */
export function header(headers: HeaderMap, name: string): string | null {
  const list = headers.get(name.toLowerCase());
  return list === undefined || list.length === 0 ? null : list[0];
}

/** `Message-ID` без угловых скобок; пусто — письмо без него. */
export function messageIdOf(headers: HeaderMap): string | null {
  const raw = header(headers, "message-id");
  if (raw === null) return null;
  const inner = /<([^<>]+)>/.exec(raw);
  const id = (inner ? inner[1] : raw).trim();
  return id === "" || id.length > 400 ? null : id;
}

/**
 * Текст письма: разбор MIME живёт в своём модуле (`claims/mime.ts`) — тело
 * приходит и в `quoted-printable`, и в `base64`, и несколькими частями.
 */
export function plainBody(raw: string | null | undefined): string | null {
  return typeof raw === "string" ? extractText(raw) : null;
}

export { MAX_BODY_CHARS };

/**
 * Прочитать непрочитанные письма ящика. Возвращает письма и замыкание,
 * которым прогон помечает разобранные: помечать внутри нельзя, пока заявка не
 * записана — иначе сбой записи потерял бы письмо навсегда.
 */
export async function readInbox(
  config: ClaimMailboxConfig,
): Promise<{ messages: InboundMessage[]; done: (uids: number[]) => Promise<void> }> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.pass },
    logger: false,
    socketTimeout: TIMEOUT_MS,
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  const messages: InboundMessage[] = [];
  try {
    const uids = (await client.search({ seen: false }, { uid: true })) || [];
    const take = uids.slice(0, MAX_FETCH);
    for (const uid of take) {
      const msg = await client.fetchOne(
        String(uid),
        { uid: true, source: true, internalDate: true },
        { uid: true },
      );
      if (msg === false || msg === undefined || msg.source === undefined) continue;
      const raw = msg.source.toString("utf8");
      const headEnd = raw.search(/\r?\n\r?\n/);
      const headers = parseHeaders(headEnd === -1 ? raw : raw.slice(0, headEnd));
      const id = messageIdOf(headers);
      const from = header(headers, "from");
      if (id === null || from === null) continue;
      messages.push({
        uid,
        messageId: id,
        // Имя отправителя и тема приходят кодированными словами RFC 2047:
        // без разбора в деле стояло бы `=?UTF-8?Q?…` (поймано разведкой 24.11).
        from: decodeHeaderWords(from),
        to: header(headers, "to"),
        subject: (() => {
          const value = header(headers, "subject");
          return value === null ? null : decodeHeaderWords(value);
        })(),
        // Разбирается письмо целиком: части лежат в теле, а их заголовки —
        // внутри каждой части.
        bodyText: plainBody(raw),
        authResults: headers.get("authentication-results") ?? [],
        // `internalDate` приходит и строкой: приведение обязательно, иначе в
        // базу уехала бы строка вместо времени.
        receivedAt: msg.internalDate ? new Date(msg.internalDate) : new Date(),
      });
    }
  } finally {
    lock.release();
  }

  const done = async (uids: number[]) => {
    if (uids.length === 0) {
      await client.logout().catch(() => {});
      return;
    }
    const list = uids.join(",");
    try {
      await client.messageFlagsAdd(list, ["\\Seen"], { uid: true });
      await client.messageMove(list, "Archive", { uid: true }).catch(() => {});
    } finally {
      await client.logout().catch(() => {});
    }
  };

  return { messages, done };
}
