/**
 * Что предприятие показывает на витрине (слайс BU).
 *
 * Умолчание — «показывать», кроме точного адреса у предприятия **без точек**:
 * такое предприятие торгует онлайн, и его адрес часто домашний. Отсутствие записи
 * читается как умолчание, поэтому у нынешних предприятий не меняется ничего.
 *
 * Скрыть можно только то, скрытие чего ничего не ломает. Витринное имя,
 * юридическое имя, страна с городом, вид с отраслью, политика возврата и адреса
 * **точек** выключателей не имеют: первое — то, с кем человек имеет дело, второе
 * подтверждено проверкой, третье — то, по чему предприятие находят, политика
 * возврата обязана показываться всегда (правило BN), а точки стоят на карте, и
 * обещать тайну, которой нет, нельзя.
 */

export const PUBLIC_FIELD_KEYS = [
  "phone",
  "email",
  "preciseAddress",
  "hours",
  "documents",
  "description",
] as const;

export type PublicFieldKey = (typeof PUBLIC_FIELD_KEYS)[number];

export type PublicFields = Record<PublicFieldKey, boolean>;

export type PublicFieldsContext = {
  /** Есть ли у предприятия хоть одна живая физическая точка. */
  hasPhysicalPoints: boolean;
};

/**
 * Умолчания. Точный адрес (улица и дом) у предприятия без точек по умолчанию
 * скрыт: человек, завёвший онлайн-магазин, не ждёт, что его домашний адрес уедет
 * на витрину, — а предприятие с точками уже стоит на карте домом и улицей.
 */
export function defaultPublicFields(ctx: PublicFieldsContext): PublicFields {
  return {
    phone: true,
    email: true,
    preciseAddress: ctx.hasPhysicalPoints,
    hours: true,
    documents: true,
    description: true,
  };
}

/**
 * Разбор сохранённого набора. Негодная запись — это «умолчание», а не исключение:
 * строку в базе мог записать прежний вид кода, и падать на ней значило бы уронить
 * витрину из-за одного поля (правило `parseWeekHours`).
 */
export function parsePublicFields(raw: unknown, ctx: PublicFieldsContext): PublicFields {
  const out = defaultPublicFields(ctx);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const row = raw as Record<string, unknown>;
  for (const key of PUBLIC_FIELD_KEYS) {
    const value = row[key];
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

/** Набор для записи: пишем все ключи, чтобы умолчание не «переехало» потом само. */
export function toPublicFieldsJson(values: Partial<Record<PublicFieldKey, boolean>>, ctx: PublicFieldsContext) {
  const base = defaultPublicFields(ctx);
  const out: Record<string, boolean> = {};
  for (const key of PUBLIC_FIELD_KEYS) out[key] = values[key] ?? base[key];
  return out;
}
