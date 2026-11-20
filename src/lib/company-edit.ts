/**
 * Правка карточки предприятия: что применяется сразу, что ждёт модератора, а что
 * требует бумаги. Спека `docs/superpowers/specs/2026-11-20-merchant-cabinet-card-tiles-design.md`, § 2.
 *
 * Принцип тот же, что в `point-edit.ts` и `coin-card-risk.ts`: делим по вреду для
 * покупателя. Описание и логотип никого не вводят в заблуждение насчёт того, с кем он
 * имеет дело; имя на витрине, адрес и способ связи — вводят. А юридическое лицо
 * подтверждается не словом заявителя, а бумагой: правка юридического имени текстовым
 * полем означала бы, что одобренную проверку можно переписать на другое лицо.
 */

/** Применяются сразу: заявление о себе, за которое отвечает сам продавец. */
export const COMPANY_FREE_FIELDS = ["description", "logoUrl"] as const;

/**
 * Ждут модератора: витрина держит прежнее значение, пока правку не одобрят.
 *
 * `address` в списке нет намеренно, хотя в базе он есть: это выводимая строка
 * («улица дом, индекс город, страна»), и показывать её рядом с правкой города
 * значило бы два изменения об одном. Она пересчитывается при одобрении правки —
 * у выводимого поля один источник, и это структурные части.
 */
export const COMPANY_MODERATED_FIELDS = [
  "displayName",
  "website",
  "phone",
  "email",
  "country",
  "countryCode",
  "city",
  "street",
  "houseNumber",
  "postalCode",
] as const;

/**
 * Требуют документов. Только юридическое имя: смена телефона перепроверки лица не
 * требует, и заставлять за неё присылать устав значило бы, что телефон никто не
 * поправит.
 */
export const COMPANY_DOCUMENT_FIELDS = ["legalName"] as const;

export type CompanyFreeField = (typeof COMPANY_FREE_FIELDS)[number];
export type CompanyModeratedField = (typeof COMPANY_MODERATED_FIELDS)[number];
export type CompanyDocumentField = (typeof COMPANY_DOCUMENT_FIELDS)[number];
export type CompanyEditField = CompanyFreeField | CompanyModeratedField | CompanyDocumentField;

/**
 * Все поля карточки в том порядке, в каком их читает человек. Логотипа в списке
 * нет намеренно: он виден самой картинкой в шапке, и строка «URL логотипа: не
 * задано» повторяла бы глазами то, что и так видно.
 */
export const COMPANY_CARD_FIELDS: CompanyEditField[] = [
  "legalName",
  "displayName",
  "description",
  "website",
  "phone",
  "email",
  "country",
  "city",
  "street",
  "houseNumber",
  "postalCode",
];

export type CompanyEditState = Partial<Record<CompanyEditField, string | null | undefined>>;

export type FieldChange = { field: CompanyEditField; before: string | null; after: string | null };

export type CompanyEditSplit = {
  /** Поля, которые пишутся в предприятие сразу. */
  free: Partial<Record<CompanyFreeField, string | null>>;
  /** Изменения, которые ждут решения модератора (включая документальные). */
  pending: FieldChange[];
  /** Среди ждущих есть такие, к которым нужна бумага. */
  needsDocuments: boolean;
};

function norm(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Разбор правки на три класса. Пустая строка и `null` — одно и то же «не задано»:
 * иначе очистка поля, которое и так пусто, выглядела бы изменением и будила бы
 * модератора без причины.
 */
export function splitCompanyEdit(before: CompanyEditState, after: CompanyEditState): CompanyEditSplit {
  const free: Partial<Record<CompanyFreeField, string | null>> = {};
  for (const field of COMPANY_FREE_FIELDS) {
    const b = norm(before[field]);
    const a = norm(after[field]);
    if (b !== a) free[field] = a;
  }

  const pending: FieldChange[] = [];
  let needsDocuments = false;
  for (const field of [...COMPANY_DOCUMENT_FIELDS, ...COMPANY_MODERATED_FIELDS]) {
    const b = norm(before[field]);
    const a = norm(after[field]);
    if (b === a) continue;
    pending.push({ field, before: b, after: a });
    if ((COMPANY_DOCUMENT_FIELDS as readonly string[]).includes(field)) needsDocuments = true;
  }

  return { free, pending, needsDocuments };
}

/** Набор изменений как объект для записи в предприятие при одобрении правки. */
export function changesToPatch(changes: FieldChange[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const c of changes) out[c.field] = c.after;
  return out;
}

/** Разбор сохранённого в JSONB набора изменений. Негодная строка выбрасывается. */
export function parseChanges(raw: unknown): FieldChange[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set<string>([
    ...COMPANY_FREE_FIELDS,
    ...COMPANY_MODERATED_FIELDS,
    ...COMPANY_DOCUMENT_FIELDS,
  ]);
  const out: FieldChange[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.field !== "string" || !known.has(row.field)) continue;
    out.push({
      field: row.field as CompanyEditField,
      before: typeof row.before === "string" ? row.before : null,
      after: typeof row.after === "string" ? row.after : null,
    });
  }
  return out;
}
