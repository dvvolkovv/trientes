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

import { joinIdList, sameIdList, splitIdList } from "@/lib/id-list";

/**
 * Применяются сразу: заявление о себе, за которое отвечает сам продавец.
 *
 * Вид заведения и политика возврата (слайс BN) свободны по разным причинам, и обе
 * стоит помнить. Вид не меняет ни места, ни принимаемых монет, ни хозяина — а
 * очередь за уточнение вида означала бы, что вид никто не уточнит (злоупотребление
 * ловится жалобой на точку, AQ). Политика возврата — собственное обещание продавца
 * покупателю, и чем быстрее оно появляется на витрине, тем лучше покупателю.
 */
export const COMPANY_FREE_FIELDS = [
  "description",
  "logoUrl",
  "category",
  "returnPolicy",
  "returnDays",
  // Слайс BU. Отрасль и своя рубрика — тот же разбор, что вид заведения: они не
  // меняют ни места, ни принимаемых монет, ни хозяина, а очередь за уточнение
  // отрасли означала бы, что отрасль никто не уточнит. Форма логотипа и часы
  // конторы — и вовсе вид и режим, а не утверждение о себе.
  "industry",
  "industryCustom",
  "logoShape",
  "logoFit",
  "timezone",
  // Слайс BY: способы оплаты помимо монет. Монеты модерируются (они фильтруют
  // карту и по ним ищут), а «принимаем наличные» фильтром не служит и ловится
  // жалобой — тот же разбор, что вид заведения и часы.
  "paymentMethods",
] as const;

/**
 * Поля, которые в базе **списки ключей** (слайс BX). Набор изменений ведётся
 * строками — их читает человек в кабинете и модератор в деле, — а в предприятие
 * надо записать массив. Второй путь записи (одобренная правка) идёт через тот же
 * `toCompanyPatch`, поэтому правило живёт в одном месте.
 */
export const COMPANY_LIST_FIELDS = ["acceptedCoinIds", "acceptedCardIds", "paymentMethods"] as const;

/**
 * Поля, которые в базе целые числа. Набор изменений и сравнение «было → стало»
 * ведутся строками (их читает человек), а в предприятие нужно записать число —
 * иначе Postgres откажет на `"14"` в колонке `integer`.
 */
export const COMPANY_INT_FIELDS = ["returnDays"] as const;

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
  // Слайс BX. Набор монет предприятия наследуют его точки, а смена монет у точки
  // возвращает её в очередь (`POINT_MODERATED_FIELDS`). Дай менять наследуемый
  // набор молча — и один и тот же покупательский смысл («здесь принимают X») шёл
  // бы то через модератора, то мимо него. Это и есть обход правила.
  "acceptedCoinIds",
  "acceptedCardIds",
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
 * Требуют документов: юридическое имя и реквизиты (слайс BV). Смена телефона
 * перепроверки лица не требует, и заставлять за неё присылать устав значило бы, что
 * телефон никто не поправит, — а номер регистрации это имя лица на языке реестра, и
 * правка его словом заявителя означала бы, что одобренную проверку можно переписать
 * на другое лицо. Налоговый номер там же: по нему предприятие сверяют в налоговом
 * реестре страны, и подменённый номер уводит проверку на чужое лицо.
 */
export const COMPANY_DOCUMENT_FIELDS = ["legalName", "registrationNumber", "taxNumber"] as const;

export type CompanyFreeField = (typeof COMPANY_FREE_FIELDS)[number];
export type CompanyModeratedField = (typeof COMPANY_MODERATED_FIELDS)[number];
export type CompanyDocumentField = (typeof COMPANY_DOCUMENT_FIELDS)[number];
export type CompanyEditField = CompanyFreeField | CompanyModeratedField | CompanyDocumentField;

/**
 * Все поля карточки в том порядке, в каком их читает человек. Логотипа в списке
 * нет намеренно: он виден самой картинкой в шапке, и строка «URL логотипа: не
 * задано» повторяла бы глазами то, что и так видно. Там же нет формы логотипа и
 * часового пояса (слайс BU): форма видна самим логотипом, пояс — расписанием.
 */
export const COMPANY_CARD_FIELDS: CompanyEditField[] = [
  "legalName",
  "registrationNumber",
  "taxNumber",
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
  "category",
  "industry",
  "industryCustom",
  "returnDays",
  "returnPolicy",
];

export type CompanyEditState = Partial<
  Record<CompanyEditField, string | number | string[] | null | undefined>
>;

/**
 * Значения для записи в предприятие: целые поля — числами, остальные строками.
 * Одно место на оба пути записи (свободные поля сразу и одобренная правка), иначе
 * второй путь однажды запишет строку в число.
 */
export function toCompanyPatch(
  values: Partial<Record<CompanyEditField, string | null>>,
): Record<string, string | number | string[] | null> {
  const out: Record<string, string | number | string[] | null> = {};
  for (const [field, value] of Object.entries(values)) {
    if ((COMPANY_LIST_FIELDS as readonly string[]).includes(field)) {
      out[field] = splitIdList(value);
      continue;
    }
    if ((COMPANY_INT_FIELDS as readonly string[]).includes(field)) {
      out[field] = value === null || value === undefined || value === "" ? null : Number(value);
      continue;
    }
    out[field] = value ?? null;
  }
  return out;
}

export type FieldChange = { field: CompanyEditField; before: string | null; after: string | null };

export type CompanyEditSplit = {
  /** Поля, которые пишутся в предприятие сразу. */
  free: Partial<Record<CompanyFreeField, string | null>>;
  /** Изменения, которые ждут решения модератора (включая документальные). */
  pending: FieldChange[];
  /** Среди ждущих есть такие, к которым нужна бумага. */
  needsDocuments: boolean;
};

function norm(v: string | number | string[] | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  // Список ключей приходит и массивом (строка предприятия из базы), и строкой
  // (значение формы). Приводим к одному виду здесь, чтобы сравнение «было →
  // стало» не зависело от того, с какой стороны пришло значение.
  if (Array.isArray(v)) return joinIdList(v);
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
    // У списка ключей перестановка изменением не является (правило `sameIdList`).
    if ((COMPANY_LIST_FIELDS as readonly string[]).includes(field)) {
      if (sameIdList(b, a)) continue;
      pending.push({ field, before: b, after: a });
      continue;
    }
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

/**
 * Ключ строки перевода для подписи поля карточки.
 *
 * Обычно он совпадает с именем поля, но у вида заведения и отрасли под тем же
 * именем лежат **названия значений** (`business.category.grocery`), и `t("category")`
 * метил бы в объект — на экране вместо подписи стоял бы путь ключа. Своя подпись,
 * а не переименование реестра: названия видов читают кабинет, витрина и навигатор.
 */
export function companyFieldLabelKey(field: CompanyEditField): string {
  if (field === "category") return "categoryLabel";
  if (field === "industry") return "industryLabel";
  return field;
}
