/**
 * Карта разделов кабинета предприятия: три группы и девять плиток (слайс BM).
 *
 * Карта одна и чистая — по ней рисуются и плитки групп, и плитки внутри группы, и
 * ею же сверяется полнота в тесте: раздел прав, до которого в кабинете не добраться,
 * это право без двери (прецедент `tests/merchant-labels.test.ts`).
 *
 * Почему два уровня, а не девять плиток подряд: владелец сказал про нынешнюю ленту
 * ссылок «очень тяжёлый дизайн». Девять квадратов под карточкой — это четыре с
 * половиной экрана телефона, и выбор из девяти равноправных вещей человек не делает,
 * он сначала выбирает, про что сейчас думает.
 */
import { can, type TeamPermissions, type TeamSection } from "@/lib/company-team/permissions";

export const COMPANY_GROUPS = ["showcase", "household", "order"] as const;
export type CompanyGroupKey = (typeof COMPANY_GROUPS)[number];

export const GROUP_ICONS: Record<CompanyGroupKey, string> = {
  showcase: "🏷️",
  household: "🏬",
  order: "👥",
};

export type CompanyTileDef = {
  key: string;
  group: CompanyGroupKey;
  /** Знак на плитке. Один символ: растры и svg чужих хостов тут не нужны (правило AN). */
  icon: string;
  /** Раздел прав, которым плитка охраняется. */
  section: TeamSection;
  /** Путь внутри `/cabinet/companies/<id>/`. */
  path: string;
  /**
   * Видно всем членам независимо от права. Только у задач: свои задачи есть у
   * каждого, и поручение, которого исполнитель не видит, — не поручение (BF).
   */
  everyone?: true;
  /** Видно только владельцу: команда и журнал правами не настраиваются (BE). */
  ownerOnly?: true;
};

export const COMPANY_TILES: CompanyTileDef[] = [
  { key: "points", group: "showcase", icon: "📍", section: "points", path: "points" },
  { key: "products", group: "showcase", icon: "📦", section: "products", path: "products" },
  { key: "pricing", group: "showcase", icon: "💰", section: "pricing", path: "loyalty" },
  { key: "promos", group: "showcase", icon: "📣", section: "promos", path: "promos" },

  { key: "warehouses", group: "household", icon: "🏬", section: "warehouses", path: "warehouses" },
  { key: "supply", group: "household", icon: "🚚", section: "supply", path: "supply" },

  { key: "team", group: "order", icon: "👥", section: "card", path: "team", ownerOnly: true },
  { key: "tasks", group: "order", icon: "✅", section: "tasks", path: "tasks", everyone: true },
  // Чат виден каждому члену и своего раздела прав не имеет: комната принадлежит
  // команде, а право, умеющее только замолчать человека, — управление, не доступ (BP).
  { key: "chat", group: "order", icon: "💬", section: "card", path: "chat", everyone: true },
  { key: "journal", group: "order", icon: "🧾", section: "card", path: "journal", ownerOnly: true },
];

export type NavGate = { permissions: TeamPermissions; isOwner: boolean };

export function tileVisible(tile: CompanyTileDef, gate: NavGate): boolean {
  if (tile.ownerOnly) return gate.isOwner;
  if (tile.everyone) return true;
  return can(gate.permissions, tile.section, "VIEW");
}

export function visibleTiles(group: CompanyGroupKey, gate: NavGate): CompanyTileDef[] {
  return COMPANY_TILES.filter((t) => t.group === group && tileVisible(t, gate));
}

/**
 * Группы, которые человеку видно. Группа без ни одной доступной плитки не
 * показывается вовсе — правило BE: «нет уровня — раздела в кабинете не видно».
 */
export function visibleGroups(gate: NavGate): CompanyGroupKey[] {
  return COMPANY_GROUPS.filter((g) => visibleTiles(g, gate).length > 0);
}

export function groupByKey(key: string): CompanyGroupKey | null {
  return (COMPANY_GROUPS as readonly string[]).includes(key) ? (key as CompanyGroupKey) : null;
}
