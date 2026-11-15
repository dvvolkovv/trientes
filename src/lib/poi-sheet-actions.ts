/**
 * Подвал карточки точки: какие кнопки в нём стоят.
 *
 * Вынесено из компонента ради одного свойства, которое легко потерять глазами:
 * у кнопки должно быть одно место. Пока маршрута нет, «Поехали» означает
 * «построй и веди», и рядом стоит «Маршрут» (построить, не ведя). Как только
 * маршрут есть, «Маршрут» уходит — его работу делают таблетки режима, — а
 * рядом с «Поехали» появляется «Очистить». Повтор подписи сделал бы клик по
 * имени кнопки неоднозначным и для пользователя, и для e2e-теста.
 */

export type SheetActionKey = "routeHere" | "go" | "clearRoute";

export type SheetAction = {
  key: SheetActionKey;
  /** Ключ подписи в пространстве `cryptoMap`. */
  labelKey: string;
  kind: "primary" | "secondary" | "text";
};

export function footerActions(hasRoute: boolean): SheetAction[] {
  if (hasRoute) {
    return [
      { key: "go", labelKey: "go", kind: "primary" },
      { key: "clearRoute", labelKey: "clearRoute", kind: "text" },
    ];
  }
  return [
    { key: "routeHere", labelKey: "routeHere", kind: "primary" },
    { key: "go", labelKey: "go", kind: "secondary" },
  ];
}
