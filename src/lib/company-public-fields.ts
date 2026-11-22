/**
 * Что предприятие показывает на витрине (слайс BU).
 *
 * Умолчание — «показывать», кроме точного адреса у предприятия **без точек**:
 * такое предприятие торгует онлайн, и его адрес часто домашний. Отсутствие записи
 * читается как умолчание, поэтому у нынешних предприятий не меняется ничего.
 *
 * Скрыть можно только то, скрытие чего ничего не ломает. Витринное имя,
 * юридическое имя, страна с городом, вид с отраслью и адреса **точек**
 * выключателей не имеют: первое — то, с кем человек имеет дело, второе
 * подтверждено проверкой, третье — то, по чему предприятие находят, а точки
 * стоят на карте, и обещать тайну, которой нет, нельзя.
 *
 * **Политика возврата — выключатель по решению владельца 22 ноября**, и это
 * сознательная отмена правила BN («показывается всегда, не указана — говорим это
 * словами»). Разбор BN остаётся верным: молчание создаёт впечатление в обе
 * стороны. Но строка «продавец не указал политику возврата» стоит на витрине у
 * каждого предприятия по умолчанию, и продавец, у которого возврата нет по роду
 * дела, читал её как упрёк. Поэтому выбор отдан ему: выключено — строки нет
 * вовсе, а не «возврата нет».
 */

export const PUBLIC_FIELD_KEYS = [
  "phone",
  "email",
  "preciseAddress",
  "hours",
  "documents",
  "description",
  "returnPolicy",
  // Слайс BX: модули, которые видно и на витрине, и в карточке с карты. Прежде
  // набор читала только витрина, а фид навигатора не читал ни одного выключателя —
  // телефон и описание уходили на карту независимо от того, что продавец выключил.
  // Выключенный модуль **вырезается из ответа фида**, а не прячется в браузере:
  // фид публичный, и «скрыть в вёрстке» значит отдать наружу то, что велели не отдавать.
  "photos",
  "coins",
  "socials",
  "website",
  "products",
  "promos",
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
    returnPolicy: true,
    photos: true,
    coins: true,
    socials: true,
    website: true,
    products: true,
    promos: true,
  };
}

/**
 * Поля, чьё умолчание от контекста не зависит, — то есть все, кроме точного
 * адреса. Нужны там, где выключатель читается в одиночку и число точек
 * предприятия спрашивать было бы лишним запросом: подстановка `hasPhysicalPoints:
 * false` ради одного поля однажды соврала бы про адрес.
 */
export type ContextFreePublicField = Exclude<PublicFieldKey, "preciseAddress">;

/** Один выключатель без контекста. Негодная запись читается как умолчание. */
export function publicFieldOn(raw: unknown, key: ContextFreePublicField): boolean {
  const fallback = defaultPublicFields({ hasPhysicalPoints: false })[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : fallback;
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
