/**
 * Цвет контура раздела — одно хранилище на админку и на кабинет.
 *
 * Палитра закрытая: произвольный цвет из поля ввода попадал бы в стиль (тот же
 * класс дыр, от которого защищается санитайз `socials`), а тёмный тон на тёмном
 * фоне прятал бы кнопку целиком. Значения проверены на фоне `--color-card`.
 */
import { ADMIN_SECTIONS } from "@/lib/admin-sections";
import { CABINET_COLOR_KEYS } from "@/lib/cabinet/personal-nav";

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

/**
 * Ключи разделов кабинета несут приставку `cab:`. У админки уже есть `companies`
 * и `coins`, у кабинета свои предприятия и монеты — это разные двери, и без
 * приставки цвет своей компании красил бы администраторскую очередь компаний.
 */
const SECTION_KEYS = new Set<string>([
  ...ADMIN_SECTIONS.map((s) => s.key),
  ...CABINET_COLOR_KEYS,
]);

export function isSectionKey(value: unknown): value is string {
  return typeof value === "string" && SECTION_KEYS.has(value);
}

export function isSectionColorKey(value: unknown): value is SectionColorKey {
  return typeof value === "string" && value in SECTION_COLORS;
}

export type SectionColorMap = Record<string, SectionColorKey>;

/**
 * Чтение словаря из базы. Неизвестный ключ молча пропускается, а не роняет
 * отрисовку: реестр со временем меняется, а записанный словарь остаётся тем же,
 * и исчезнувший раздел не должен стоить человеку страницы.
 */
export function readSectionColors(value: unknown): SectionColorMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: SectionColorMap = {};
  for (const [key, color] of Object.entries(value as Record<string, unknown>)) {
    if (isSectionKey(key) && isSectionColorKey(color)) out[key] = color;
  }
  return out;
}

/** Цвет раздела для стиля, или `null` — тогда остаётся обычный контур. */
export function sectionColorHex(colors: SectionColorMap, key: string): string | null {
  if (!isSectionKey(key)) return null;
  const color = colors[key];
  return color ? SECTION_COLORS[color] : null;
}

/**
 * Цвет фильтра по состоянию заявки. Это не личная настройка: «одобрено» значит
 * одно и то же у любого человека, и возможность назвать «отклонено» зелёным
 * была бы ловушкой для сменщика. Прецедент — точка срока `SLA_DOT`.
 */
export const STATUS_FILTER_COLORS = {
  PENDING: "amber",
  APPROVED: "green",
  REJECTED: "red",
} as const satisfies Record<string, SectionColorKey>;

export function statusFilterHex(status: string): string | null {
  const key = STATUS_FILTER_COLORS[status.toUpperCase() as keyof typeof STATUS_FILTER_COLORS];
  return key ? SECTION_COLORS[key] : null;
}
