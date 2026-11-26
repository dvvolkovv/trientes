/**
 * Права внутри предприятия — чистые правила, без Prisma. Спека
 * `docs/superpowers/specs/2026-11-19-merchant-team-roles-design.md`, разделы 2–5.
 *
 * Разделов восемь, и каждый охраняет живые действия кабинета. Право, за которым нет ни
 * одного охраняемого действия, не заводим: эквайринга и отчётности в проекте нет (то же
 * решение, что `minQty` в BC — «в схеме не заводим, пока нечему его читать»). Раздел
 * `promos` появился в BG вместе с акциями: до него рекламы в проекте не было, а `supply`
 * — в BI вместе с заказами поставщику. Почему заказ не лёг в `warehouses`: кладовщик,
 * которому поручено вести приход на полку, не должен заказывать у поставщика — заказ это
 * обещание заплатить (тот же мотив, которым BE отделил `pricing` от `warehouses`).
 *
 * Десятый раздел `hiring` — слайс CH, просьба владельца: директор вправе поручить
 * выпуск приглашений кадровику. Это уточнение правила BE «команда правами не
 * настраивается», а не его отмена: кадровик **зовёт** людей (ссылка и её отзыв), а
 * состав команды, роли и конструктор прав остаются у владельца. Приглашение с ролью
 * `OWNER` кадровику недоступно — иначе позванный им человек получил бы право звать
 * кого угодно кем угодно, то есть запрет `self_grant` обходился бы через второго
 * человека.
 *
 * Одиннадцатый раздел `sales` — слайс CK, касса: это и есть кассир из ТЗ 6.6, которого
 * BE не завёл («кассы нет, а шаблон с пустым набором прав — насмешка»). В наследие фазы
 * 10 он, в отличие от `hiring`, **входит**: касса — обычная работа предприятия, и
 * легаси-редактор, уже правящий цену и остаток, не получает с ней власти ни над
 * командой, ни над чужими деньгами.
 *
 * Двенадцатый раздел `reports` — слайс CL, отчётность: ТЗ 6.6 прямо называет
 * «отчётность» разделом доступов, и BE его не завёл по тому же правилу «право, за
 * которым нет действий, — обещание, а не доступ». Уровни тут значат разное:
 * `VIEW` смотрит сводку на экране, `EDIT` **выгружает файл** — вынос данных за
 * пределы платформы это другое действие, и каждая выгрузка ложится в журнал.
 * В наследие фазы 10 раздел входит, как `sales`: легаси-редактор уже видит каждый
 * чек, и сводка над теми же чеками новой власти ему не даёт.
 *
 * Тринадцатый раздел `automation` — слайс CO, ТЗ 6.7 «конструктор правил «если — то»».
 * В наследие фазы 10 он **не входит** (как `hiring` и в отличие от `sales` и `reports`):
 * правило действует **без человека** — само ставит задачи и само будит людей, — и
 * живым членам, заведённым до того, как раздел появился, этого права никто не давал.
 * Исходящие оповещения наружу при этом остаются у владельца и правами не настраиваются:
 * данные уходят за пределы платформы, то есть это выдача прав (решение CL о ключах API).
 *
 * Девятый раздел `customers` появился в BQ вместе с перепиской покупателя: ТЗ 6.6 прямо
 * говорит «сотрудники **с нужной ролью** отвечают на сообщения покупателей». Общий чат
 * команды (BP) раздела прав не получил — комната принадлежит команде, — а внешняя
 * переписка не принадлежит всей команде по построению: покупатель пишет магазину, и
 * говорить от имени магазина вправе не каждый.
 */

/** Ролей на предприятие — столько, сколько читает человек в списке. */
export const MAX_TEAM_ROLES = 20;

export const TEAM_SECTIONS = ["card", "points", "products", "warehouses", "pricing", "tasks", "promos", "supply", "customers", "hiring", "sales", "reports", "automation"] as const;
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

function fill(level: TeamLevel, sections: readonly TeamSection[] = TEAM_SECTIONS): TeamPermissions {
  const out: TeamPermissions = {};
  for (const section of sections) out[section] = level;
  return out;
}

export const ALL_EDIT: TeamPermissions = fill("EDIT");
export const ALL_VIEW: TeamPermissions = fill("VIEW");

/**
 * Что получает член **без своей роли** — наследие фазы 10. `hiring` и `automation` сюда
 * не входят:
 * эти члены заведены до того, как раздел появился, и никто не решал давать им право
 * звать людей в команду и заводить правила, которые действуют без человека. Молчаливое
 * расширение прав живого редактора было бы ровно тем, от чего охраняет запрет по
 * умолчанию.
 */
const LEGACY_SECTIONS = TEAM_SECTIONS.filter((s) => s !== "hiring" && s !== "automation");
const LEGACY_EDIT: TeamPermissions = fill("EDIT", LEGACY_SECTIONS);
const LEGACY_VIEW: TeamPermissions = fill("VIEW", LEGACY_SECTIONS);

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
  return member.role === "EDITOR" ? { ...LEGACY_EDIT } : { ...LEGACY_VIEW };
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
 * Шаблоны ролей из ТЗ 6.6. Кассир появился с кассой (CK), бухгалтер — с отчётностью
 * (CL): до них шаблон с пустым набором прав был бы насмешкой. Шаблон только заполняет галочки формы;
 * сохранённая роль хранит свой набор и от шаблона больше не зависит.
 */
export const ROLE_TEMPLATES: { key: string; permissions: TeamPermissions }[] = [
  { key: "manager", permissions: { card: "EDIT", points: "EDIT", products: "EDIT", warehouses: "EDIT", pricing: "EDIT", tasks: "EDIT", promos: "EDIT", supply: "EDIT", customers: "EDIT", hiring: "EDIT", sales: "EDIT", reports: "EDIT", automation: "EDIT" } },
  // Кассир проводит продажи и больше не делает ничего: товар ему надо видеть, чтобы
  // выбрать строку чека, а цену ставит предложение продавца, не он.
  { key: "cashier", permissions: { sales: "EDIT", products: "VIEW" } },
  // Бухгалтер из ТЗ 6.6 — второй шаблон, которого BE не завёл («отчётности в проекте
  // нет»). Он уносит цифры консультанту, поэтому `reports: EDIT`; чеки ему надо
  // видеть, но кассой он не работает, и товар — только читать.
  { key: "accountant", permissions: { reports: "EDIT", sales: "VIEW", products: "VIEW" } },
  // Кадровик зовёт людей и больше не делает ничего: витрина, склад и цена к найму
  // отношения не имеют.
  { key: "hr", permissions: { hiring: "EDIT", tasks: "VIEW" } },
  // Кладовщик видит, что едет на его полку, но не заказывает: заказ — обещание денег.
  // Кассы у него тоже нет: уход товара по чеку — работа кассира.
  { key: "stock", permissions: { points: "VIEW", products: "VIEW", warehouses: "EDIT", tasks: "VIEW", supply: "VIEW" } },
  // Маркетолог и есть голос магазина — переписку с покупателем ведёт он.
  { key: "marketing", permissions: { card: "EDIT", products: "VIEW", pricing: "EDIT", tasks: "VIEW", promos: "EDIT", customers: "EDIT" } },
  { key: "observer", permissions: { card: "VIEW", points: "VIEW", products: "VIEW", warehouses: "VIEW", pricing: "VIEW", tasks: "VIEW", promos: "VIEW", supply: "VIEW", customers: "VIEW", hiring: "VIEW", sales: "VIEW", reports: "VIEW", automation: "VIEW" } },
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

/**
 * Какую роль вправе выдать приглашением тот, кто его выпускает. Владелец — любую;
 * кадровик — любую, кроме владельца: приглашение в `OWNER` отдало бы предприятие
 * целиком, а право «звать» задумано как наём, а не передача дел.
 */
export function inviteRoleAllowed(isOwner: boolean, role: "OWNER" | "EDITOR" | "VIEWER"): boolean {
  return isOwner || role !== "OWNER";
}
