/**
 * Права внутри предприятия — чистые правила, без Prisma. Спека
 * `docs/superpowers/specs/2026-11-19-merchant-team-roles-design.md`, разделы 2–5.
 *
 * Разделов пять, и каждый охраняет живые действия кабинета. Право, за которым нет ни
 * одного охраняемого действия, не заводим: эквайринга, отчётности и рекламы в проекте
 * нет (то же решение, что `minQty` в BC — «в схеме не заводим, пока нечему его читать»).
 */

/** Ролей на предприятие — столько, сколько читает человек в списке. */
export const MAX_TEAM_ROLES = 20;

export const TEAM_SECTIONS = ["card", "points", "products", "warehouses", "pricing"] as const;
export type TeamSection = (typeof TEAM_SECTIONS)[number];

/** Уровней два; отсутствие строки — запрет по умолчанию, как очередь без гранта в AS. */
export const TEAM_LEVELS = ["VIEW", "EDIT"] as const;
export type TeamLevel = (typeof TEAM_LEVELS)[number];

export type TeamPermissions = Partial<Record<TeamSection, TeamLevel>>;

const SECTION_SET = new Set<string>(TEAM_SECTIONS);
const LEVEL_SET = new Set<string>(TEAM_LEVELS);

/**
 * Разбор набора прав из JSONB. Неизвестный раздел выбрасывается (раздел мог исчезнуть из
 * кода), негодный уровень означает запрет, а не «что-нибудь»: запрет по умолчанию.
 */
export function parsePermissions(raw: unknown): TeamPermissions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: TeamPermissions = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SECTION_SET.has(key)) continue;
    if (typeof value !== "string" || !LEVEL_SET.has(value)) continue;
    out[key as TeamSection] = value as TeamLevel;
  }
  return out;
}

function fill(level: TeamLevel): TeamPermissions {
  const out: TeamPermissions = {};
  for (const section of TEAM_SECTIONS) out[section] = level;
  return out;
}

export const ALL_EDIT: TeamPermissions = fill("EDIT");
export const ALL_VIEW: TeamPermissions = fill("VIEW");

export type TeamMemberGate = {
  role: "OWNER" | "EDITOR" | "VIEWER";
  /** Набор прав своей роли предприятия; `null` — роли нет, работает наследие. */
  rolePermissions: TeamPermissions | null;
};

/**
 * Права члена. Владелец не настраивается — иначе набор прав можно довести до состояния,
 * из которого нет выхода (тот же мотив, что запрет понижать последнего владельца).
 * Роли нет — работает наследие фазы 10: `EDITOR` правил всё, `VIEWER` смотрел всё, и
 * живые члены в базе должны сохранить ровно это поведение до назначения роли.
 */
export function permissionsFor(member: TeamMemberGate | null | undefined): TeamPermissions {
  if (!member) return {};
  if (member.role === "OWNER") return { ...ALL_EDIT };
  if (member.rolePermissions) return { ...member.rolePermissions };
  return member.role === "EDITOR" ? { ...ALL_EDIT } : { ...ALL_VIEW };
}

/** Есть ли у набора прав нужный уровень по разделу. `EDIT` включает `VIEW`. */
export function can(perms: TeamPermissions, section: TeamSection, level: TeamLevel): boolean {
  const have = perms[section];
  if (!have) return false;
  return level === "VIEW" ? true : have === "EDIT";
}

/** Разделы, которые человеку вообще видно — по ним рисуется полоса кабинета. */
export function visibleSections(perms: TeamPermissions): TeamSection[] {
  return TEAM_SECTIONS.filter((section) => can(perms, section, "VIEW"));
}

/**
 * Шаблоны ролей из ТЗ 6.6. Кассира и бухгалтера не заводим: кассы и отчётности в проекте
 * нет, а шаблон с пустым набором прав — насмешка. Шаблон только заполняет галочки формы;
 * сохранённая роль хранит свой набор и от шаблона больше не зависит.
 */
export const ROLE_TEMPLATES: { key: string; permissions: TeamPermissions }[] = [
  { key: "manager", permissions: { card: "EDIT", points: "EDIT", products: "EDIT", warehouses: "EDIT", pricing: "EDIT" } },
  { key: "stock", permissions: { points: "VIEW", products: "VIEW", warehouses: "EDIT" } },
  { key: "marketing", permissions: { card: "EDIT", products: "VIEW", pricing: "EDIT" } },
  { key: "observer", permissions: { card: "VIEW", points: "VIEW", products: "VIEW", warehouses: "VIEW", pricing: "VIEW" } },
];

/**
 * Сужение по точкам продаж. Пустой список — все точки, и это нормальное состояние
 * предприятия с одной точкой.
 */
export function pointScopeAllows(scope: readonly string[], pointId: string | null | undefined): boolean {
  if (scope.length === 0) return true;
  // Склад без точки принадлежит предприятию целиком, а не участку: сотрудник одной точки
  // центральный склад не трогает — в этом и смысл слов «доступы по точкам продаж».
  if (!pointId) return false;
  return scope.includes(pointId);
}

/**
 * Движение между складами: оба конца должны быть в участке. Иначе сотрудник вывозил бы
 * товар на склад, которого не видит.
 */
export function movementScopeAllows(
  scope: readonly string[],
  ends: { fromPointId?: string | null; toPointId?: string | null },
): boolean {
  if (scope.length === 0) return true;
  if (ends.fromPointId !== undefined && !pointScopeAllows(scope, ends.fromPointId)) return false;
  if (ends.toPointId !== undefined && !pointScopeAllows(scope, ends.toPointId)) return false;
  return true;
}
