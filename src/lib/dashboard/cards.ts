/**
 * Состав сводки рабочего дня — чистые правила (слайс CM, ТЗ 6.6 «Дизайн»). Спека
 * `docs/superpowers/specs/2026-11-25-merchant-dashboard-design.md`.
 *
 * Правил тут два, и оба важнее самих чисел:
 *
 * 1. **Плитка видна только по праву на свой раздел.** Иначе сводка — дыра в модели
 *    BE: кладовщик, которому не положена выручка, прочитал бы её тут. Своего раздела
 *    прав у сводки нет — он означал бы второй путь к тем же сведениям (§ 3 спеки).
 * 2. **Крупным числом стоит то, что складывается.** У продаж это чеки, а не выручка:
 *    суммы разных валют не складываются (CK, CL), и выручка идёт строкой под числом,
 *    по валютам раздельно (§ 5 спеки).
 *
 * Своих чисел сводка не считает вовсе: правила счёта принадлежат разделам, а здесь
 * только состав и подписи (§ 2 спеки).
 */
import { can, type TeamPermissions } from "@/lib/company-team/permissions";

export const DASH_CARDS = ["sales", "stock", "tasks", "promos", "customers"] as const;
export type DashCardKey = (typeof DASH_CARDS)[number];

export type DashCardDef = {
  key: DashCardKey;
  icon: string;
  /** Путь внутри `/cabinet/companies/<id>/` — число ведёт туда, где его разбирают. */
  path: string;
  /**
   * Раздел прав, которым плитка охраняется. `null` — видно каждому члену: своя
   * задача есть у любого, и поручение, которого исполнитель не видит, — не
   * поручение (правило BF).
   */
  section: "sales" | "warehouses" | "promos" | "customers" | null;
};

export const DASH_DEFS: DashCardDef[] = [
  { key: "sales", icon: "🧾", path: "sales", section: "sales" },
  { key: "stock", icon: "🏬", path: "warehouses", section: "warehouses" },
  { key: "tasks", icon: "✅", path: "tasks", section: null },
  { key: "promos", icon: "📣", path: "promos", section: "promos" },
  { key: "customers", icon: "✉️", path: "inbox", section: "customers" },
];

export function dashCardVisible(def: DashCardDef, permissions: TeamPermissions): boolean {
  if (def.section === null) return true;
  return can(permissions, def.section, "VIEW");
}

/** Плитки, которые видно этому человеку. Порядок — порядок ТЗ, а не алфавит. */
export function visibleDashCards(permissions: TeamPermissions): DashCardDef[] {
  return DASH_DEFS.filter((def) => dashCardVisible(def, permissions));
}

/**
 * Что сводке нужно прочитать. Запрос за числом, которого человеку не видно, это
 * работа впустую — и заодно чтение сведений, на которые у него нет права
 * (то же правило, что `countTiles` на странице группы BM).
 */
export function dashNeeds(permissions: TeamPermissions): Record<DashCardKey, boolean> {
  const visible = new Set(visibleDashCards(permissions).map((d) => d.key));
  return {
    sales: visible.has("sales"),
    stock: visible.has("stock"),
    tasks: visible.has("tasks"),
    promos: visible.has("promos"),
    customers: visible.has("customers"),
  };
}
