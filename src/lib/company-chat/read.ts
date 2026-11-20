/**
 * Чтение общего чата команды. Спека
 * `docs/superpowers/specs/2026-11-20-merchant-team-chat-design.md`.
 *
 * Отозванное сообщение из выборки **не исключается**: строка остаётся в разговоре, а
 * текст на экране заменяется словами «сообщение удалено» — иначе под чужим ответом
 * исчезал бы вопрос, на который он отвечает.
 */
import { prisma } from "@/lib/prisma";
import { CHAT_PAGE, type ChatMember } from "@/lib/company-chat/rules";

export type ChatPerson = { id: string; label: string } | null;

export type ChatRow = {
  id: string;
  body: string;
  createdAt: Date;
  author: ChatPerson;
  withdrawn: boolean;
  /** Своё сообщение: его автор вправе отозвать, и непрочитанным оно не бывает. */
  mine: boolean;
  /** Этого человека позвали по имени. */
  mentionsMe: boolean;
};

const PERSON = { select: { id: true, username: true, name: true, email: true } } as const;

function person(u: { id: string; username: string | null; name: string | null; email: string | null } | null): ChatPerson {
  if (!u) return null;
  return { id: u.id, label: u.username || u.name || u.email || u.id.slice(0, 8) };
}

type Raw = {
  id: string;
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
  mentions: string[];
  author: { id: string; username: string | null; name: string | null; email: string | null } | null;
};

function row(raw: Raw, userId: string): ChatRow {
  return {
    id: raw.id,
    body: raw.deletedAt ? "" : raw.body,
    createdAt: raw.createdAt,
    author: person(raw.author),
    withdrawn: Boolean(raw.deletedAt),
    mine: raw.author?.id === userId,
    mentionsMe: !raw.deletedAt && raw.mentions.includes(userId),
  };
}

const SELECT = {
  id: true,
  body: true,
  createdAt: true,
  deletedAt: true,
  mentions: true,
  author: PERSON,
} as const;

/**
 * Страница истории: берём последние `CHAT_PAGE` до курсора и отдаём снизу вверх по
 * времени. Курсор — час сообщения, а не номер страницы: разговор растёт снизу, и
 * «страница 3» через минуту означала бы другие строки.
 */
export async function readChatPage(
  companyId: string,
  viewer: { userId: string },
  opts: { before?: Date | null } = {},
): Promise<{ rows: ChatRow[]; earlierBefore: Date | null }> {
  const raws = await prisma.companyChatMessage.findMany({
    where: { companyId, ...(opts.before ? { createdAt: { lt: opts.before } } : {}) },
    orderBy: { createdAt: "desc" },
    take: CHAT_PAGE + 1,
    select: SELECT,
  });
  const hasMore = raws.length > CHAT_PAGE;
  const page = raws.slice(0, CHAT_PAGE).reverse();
  return {
    rows: page.map((raw) => row(raw, viewer.userId)),
    earlierBefore: hasMore && page.length > 0 ? page[0].createdAt : null,
  };
}

/** Новое после известного сообщения — для опроса открытой страницы. */
export async function readChatSince(
  companyId: string,
  viewer: { userId: string },
  afterId: string | null,
): Promise<ChatRow[]> {
  const after = afterId
    ? await prisma.companyChatMessage.findFirst({
        where: { id: afterId, companyId },
        select: { createdAt: true },
      })
    : null;
  const raws = await prisma.companyChatMessage.findMany({
    where: { companyId, ...(after ? { createdAt: { gt: after.createdAt } } : {}) },
    orderBy: { createdAt: "asc" },
    // Пропавшего курсора быть не должно, но если он не нашёлся — отдаём хвост разговора,
    // а не всю историю: иначе одна забытая вкладка вытянула бы базу.
    take: CHAT_PAGE,
    select: SELECT,
  });
  return raws.map((raw) => row(raw, viewer.userId));
}

/** Члены команды для подстановки `@логин`. Логина нет — звать нечем. */
export async function readChatMembers(companyId: string): Promise<(ChatMember & { label: string })[]> {
  const members = await prisma.companyMember.findMany({
    where: { companyId },
    select: { user: PERSON },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => ({
    userId: m.user.id,
    username: m.user.username,
    label: m.user.username || m.user.name || m.user.email || m.user.id.slice(0, 8),
  }));
}

/**
 * Число непрочитанных для значка на плитке. Считается запросом, а не выборкой строк:
 * правило то же, что в чистой `unreadFrom` (свои и отозванные не считаются), но
 * непрочитанных может быть больше, чем страница истории.
 */
export async function readChatUnread(companyId: string, userId: string): Promise<number> {
  const mark = await prisma.companyChatRead.findUnique({
    where: { companyId_userId: { companyId, userId } },
    select: { lastReadAt: true },
  });
  return prisma.companyChatMessage.count({
    where: {
      companyId,
      deletedAt: null,
      NOT: { authorUserId: userId },
      ...(mark ? { createdAt: { gt: mark.lastReadAt } } : {}),
    },
  });
}
