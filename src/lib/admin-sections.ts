/**
 * Разделы админки одним списком — и для полосы кнопок в шапке, и для плиток
 * очередей, и для страницы «Вид разделов». Своя копия такого списка в проекте
 * уже однажды отставала (список локалей, уборка AU), поэтому список один.
 *
 * Цвет контура назначается ключу раздела, а не месту показа: кнопка `coinCards`
 * в шапке и плитка `coinCards` в очередях — один раздел, и цвет у него один.
 */

export type AdminSectionKey = (typeof ADMIN_SECTIONS)[number]["key"];

/**
 * `labelKey` — путь внутри пространства переводов `admin`. У разделов, которые
 * есть и закладкой, и очередью, подпись берётся из `tabs`: она там же, где
 * раздел впервые встречает глаз.
 */
export const ADMIN_SECTIONS = [
  { key: "queues", labelKey: "tabs.queues" },
  { key: "staff", labelKey: "tabs.staff" },
  { key: "requests", labelKey: "tabs.requests" },
  { key: "coinCards", labelKey: "tabs.coinCards" },
  { key: "business", labelKey: "tabs.business" },
  { key: "fintech", labelKey: "tabs.fintech" },
  { key: "exchanges", labelKey: "tabs.exchanges" },
  { key: "coins", labelKey: "tabs.coins" },
  { key: "users", labelKey: "tabs.users" },
  { key: "audit", labelKey: "tabs.audit" },
  { key: "analytics", labelKey: "tabs.analytics" },
  { key: "companies", labelKey: "queues.names.companies" },
  { key: "points", labelKey: "queues.names.points" },
  { key: "kyb", labelKey: "queues.names.kyb" },
  { key: "coinRequests", labelKey: "queues.names.coinRequests" },
  { key: "pointReports", labelKey: "queues.names.pointReports" },
  { key: "products", labelKey: "queues.names.products" },
  { key: "ads", labelKey: "queues.names.ads" },
] as const satisfies readonly { key: string; labelKey: string }[];

/** Ключи реестра для проверки на запись и чтение. */
const SECTION_KEYS = new Set<string>(ADMIN_SECTIONS.map((s) => s.key));

export function isAdminSectionKey(value: unknown): value is AdminSectionKey {
  return typeof value === "string" && SECTION_KEYS.has(value);
}
