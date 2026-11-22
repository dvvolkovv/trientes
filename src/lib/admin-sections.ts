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
] as const satisfies readonly { key: string; labelKey: string }[];

/**
 * Палитра закрытая: произвольный цвет из поля ввода попадал бы в стиль (тот же
 * класс дыр, от которого защищается санитайз `socials`), а тёмный тон на тёмном
 * фоне прятал бы кнопку целиком. Значения проверены на фоне `--color-card`.
 */
export const SECTION_COLORS = {
  red: "#e55c5c",
  orange: "#fe5c04",
  amber: "#e2a33c",
  green: "#30b658",
  teal: "#2bb6a8",
  blue: "#4d7cff",
  violet: "#9b6cff",
  pink: "#ea5fa6",
} as const;

export type SectionColorKey = keyof typeof SECTION_COLORS;

export const SECTION_COLOR_KEYS = Object.keys(SECTION_COLORS) as SectionColorKey[];

const SECTION_KEYS = new Set<string>(ADMIN_SECTIONS.map((s) => s.key));

export function isAdminSectionKey(value: unknown): value is AdminSectionKey {
  return typeof value === "string" && SECTION_KEYS.has(value);
}

export function isSectionColorKey(value: unknown): value is SectionColorKey {
  return typeof value === "string" && value in SECTION_COLORS;
}

export type SectionColorMap = Partial<Record<AdminSectionKey, SectionColorKey>>;

/**
 * Чтение словаря из базы. Неизвестный ключ молча пропускается, а не роняет
 * отрисовку: реестр со временем меняется, а записанный словарь остаётся тем же,
 * и исчезнувший раздел не должен стоить оператору страницы.
 */
export function readSectionColors(value: unknown): SectionColorMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: SectionColorMap = {};
  for (const [key, color] of Object.entries(value as Record<string, unknown>)) {
    if (isAdminSectionKey(key) && isSectionColorKey(color)) out[key] = color;
  }
  return out;
}

/** Цвет раздела для стиля, или `null` — тогда остаётся обычный контур. */
export function sectionColorHex(colors: SectionColorMap, key: string): string | null {
  if (!isAdminSectionKey(key)) return null;
  const color = colors[key];
  return color ? SECTION_COLORS[color] : null;
}
