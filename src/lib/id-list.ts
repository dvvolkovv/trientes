/**
 * Список ключей как одно значение поля.
 *
 * Набор принимаемых монет — это множество, а не строка: перестановка того же
 * набора изменением не является. Правило живёт в одном месте, потому что его
 * читают двое — правка точки (`point-edit.ts`) и правка карточки предприятия
 * (`company-edit.ts`), — и вторая копия однажды разошлась бы с первой (болезнь
 * списка локалей, уборка AU).
 */

/** Разбор значения в список ключей. Пусто, мусор и не-массив дают пустой список. */
export function splitIdList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v !== "");
  }
  return [];
}

/** Запись списка одним значением поля. Пустой список — `null`, то есть «не задано». */
export function joinIdList(ids: readonly string[]): string | null {
  const clean = splitIdList(ids as unknown);
  return clean.length === 0 ? null : clean.join(",");
}

/** Тот же набор без учёта порядка и повторов. */
export function sameIdList(a: unknown, b: unknown): boolean {
  const la = [...new Set(splitIdList(a))].sort();
  const lb = [...new Set(splitIdList(b))].sort();
  return la.length === lb.length && la.every((v, i) => v === lb[i]);
}
