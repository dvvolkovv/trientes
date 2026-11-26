/**
 * Исходящие оповещения (слайс CO, ТЗ 6.7 «открытый API и событийная архитектура») —
 * чистая часть: проверка адреса, подпись, расписание повторов, классификация отказа.
 *
 * Наружу уходит **оповещение, а не доступ**: записи через API нет и не будет в этой линии
 * — чек заводит касса кабинета, остаток склад, и вторая дверь к той же записи означала бы
 * двух авторов (правило BI, решение CL).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AUTOMATION_EVENTS, type AutomationEvent } from "@/lib/automation/events";

/** Адресов на предприятие: больше пяти внешних систем у магазина не бывает. */
export const MAX_WEBHOOKS = 5;
/** Доставок за один прогон: прогон идёт каждые две минуты и не должен в них не уложиться. */
export const DELIVERIES_PER_SWEEP = 200;
/** Срок запроса наружу — граница `tests/outbound-timeouts.test.ts`. */
export const DELIVERY_TIMEOUT_MS = 8_000;
/** События и доставки старше этого чистятся: лента — дверь отладки, а не архив. */
export const RETENTION_DAYS = 30;
export const URL_MAX = 300;

/**
 * Расписание повторов — **по времени**, а не «пять раз подряд»: служба, упавшая на
 * минуту, и служба, выключенная на сутки, требуют разного терпения. Шесть часов — предел:
 * дальше оповещение перестаёт быть оповещением.
 */
export const RETRY_MINUTES = [1, 5, 30, 120, 360] as const;

export function nextAttemptAt(attempts: number, now: Date): Date | null {
  const minutes = RETRY_MINUTES[attempts - 1];
  if (minutes === undefined) return null;
  return new Date(now.getTime() + minutes * 60_000);
}

export type UrlReason = "url_required" | "url_not_https" | "url_private" | "url_too_long";

/**
 * Частные диапазоны. На этой машине на localhost стоят Postgres, Redis и pm2, поэтому
 * webhook на свой же адрес был бы дверью в нашу сеть чужими руками (SSRF). Проверяется и
 * форма адреса, и **каждое разрешение имени перед отправкой**: имя, прошедшее проверку
 * формы, завтра может смотреть на 127.0.0.1.
 */
export function isPrivateAddress(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!name) return true;
  if (name === "localhost" || name.endsWith(".localhost") || name.endsWith(".local") || name.endsWith(".internal")) {
    return true;
  }

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, Number(v4[3]), Number(v4[4]), b].some((n) => n > 255)) return true;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  if (name.includes(":")) {
    if (name === "::" || name === "::1") return true;
    // Адрес IPv4, завёрнутый в IPv6: `::ffff:127.0.0.1`.
    const mapped = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(name);
    if (mapped) return isPrivateAddress(mapped[1]!);
    const head = name.split(":")[0] ?? "";
    if (/^f[cd][0-9a-f]{0,2}$/.test(head)) return true; // fc00::/7
    if (/^fe[89ab][0-9a-f]?$/.test(head)) return true; // fe80::/10
    return false;
  }

  // Имя без точки — это узел нашей же сети (`db`, `redis`), а не адрес в интернете.
  return !name.includes(".");
}

/** Почему адрес не годится. `null` — годится. */
export function webhookUrlReason(raw: string): UrlReason | null {
  const text = raw.trim();
  if (!text) return "url_required";
  if (text.length > URL_MAX) return "url_too_long";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "url_required";
  }
  // Только `https`: тело несёт продажи предприятия, и по `http` оно идёт открытым.
  if (url.protocol !== "https:") return "url_not_https";
  if (isPrivateAddress(url.hostname)) return "url_private";
  return null;
}

/** Набор видов события у адреса. Пустой набор — это выключенный адрес, а не «все». */
export function parseWebhookEvents(raw: unknown): AutomationEvent[] {
  const list = Array.isArray(raw) ? raw : [];
  const out = new Set<AutomationEvent>();
  for (const item of list) {
    if (typeof item === "string" && (AUTOMATION_EVENTS as readonly string[]).includes(item)) {
      out.add(item as AutomationEvent);
    }
  }
  return [...out];
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/**
 * Подпись со временем: `t=<unix>,v1=<hmac_sha256("<t>.<body>")>`. Время в подписи затем,
 * чтобы перехваченный запрос нельзя было повторить через сутки; без него подпись
 * доказывает только подлинность тела.
 */
export function signPayload(body: string, secret: string, atMs: number): string {
  const t = Math.floor(atMs / 1000);
  const mac = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${mac}`;
}

/** Проверка подписи — ею же пользуется тест и ею же воспользуется принимающая сторона. */
export function verifySignature(header: string, body: string, secret: string, nowMs: number, toleranceSec = 300): boolean {
  const parts = Object.fromEntries(
    header
      .split(",")
      .map((p) => p.trim().split("="))
      .filter((p): p is [string, string] => p.length === 2),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t)) return false;
  if (Math.abs(Math.floor(nowMs / 1000) - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const got = Buffer.from(parts.v1 ?? "", "hex");
  const want = Buffer.from(expected, "hex");
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

export type DeliveryVerdict = "delivered" | "retry" | "dropped";

/**
 * Что делать с ответом. Классификация та же, что у читателей сетей (слайс Y, уборка BO):
 * **4xx — ответ службы** (она сказала «такого адреса нет» или «не буду» — повтор ничего
 * не изменит), **5xx, 429 и обрыв — связь** (повторяем). 408 и 429 — исключения внутри
 * 4xx: оба прямо просят прийти позже.
 */
export function deliveryVerdict(status: number | null): DeliveryVerdict {
  if (status === null) return "retry"; // обрыв или срок
  if (status >= 200 && status < 300) return "delivered";
  if (status === 408 || status === 429) return "retry";
  if (status >= 400 && status < 500) return "dropped";
  return "retry";
}

/**
 * Тело оповещения. Форма одна на все виды события: один словарь на все внешние системы.
 * Складывается объектом и **этим же объектом ложится снимком** в строку доставки — то,
 * что человек видит на экране доставок, и есть то, что ушло в запрос.
 */
export function deliveryPayload(input: {
  eventId: string;
  kind: AutomationEvent;
  companyId: string;
  createdAt: Date;
  subject: string | null;
  data: unknown;
}): Record<string, unknown> {
  return {
    id: input.eventId,
    type: input.kind,
    company_id: input.companyId,
    created_at: input.createdAt.toISOString(),
    subject: input.subject,
    data: input.data ?? {},
  };
}
