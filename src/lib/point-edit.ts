// Правка точки приёма: что можно поменять молча, а что возвращает точку на
// модерацию. Без этого разделения владелец провёл бы через модератора
// безобидную точку и переписал бы её во что угодно — ровно так и выглядит
// обход модерации.
//
// Принцип тот же, что в coin-card-risk.ts: поля, которые вводят покупателя в
// заблуждение насчёт места и принимаемых монет, высокорисковые.

/** Поля, правка которых возвращает точку в очередь модерации. */
export const POINT_MODERATED_FIELDS = [
  "type",
  "name",
  "countryCode",
  "city",
  "street",
  "houseNumber",
  "postalCode",
  "lat",
  "lon",
  "acceptedCoinIds",
  "acceptedCardIds",
] as const;

type Scalar = string | number | null | undefined;
export type PointEditState = Record<string, Scalar | string[] | null | undefined>;

function sameList(a: unknown, b: unknown): boolean {
  const la = Array.isArray(a) ? [...a].map(String).sort() : [];
  const lb = Array.isArray(b) ? [...b].map(String).sort() : [];
  return la.length === lb.length && la.every((v, i) => v === lb[i]);
}

/**
 * True, если среди изменённых полей есть хотя бы одно модерируемое.
 * Порядок в списках принимаемых монет не считается изменением.
 */
export function pointEditNeedsModeration(before: PointEditState, after: PointEditState): boolean {
  for (const field of POINT_MODERATED_FIELDS) {
    const a = before[field];
    const b = after[field];
    if (field === "acceptedCoinIds" || field === "acceptedCardIds") {
      if (!sameList(a, b)) return true;
      continue;
    }
    // null и undefined — одно и то же «не задано»; числа сравниваем по значению.
    if ((a ?? null) !== (b ?? null)) return true;
  }
  return false;
}
