/**
 * Тип магазина (ТЗ § 3.1: «онлайн (режим 24/7), офлайн (часы работы по дням),
 * смешанный»), слайс BN.
 *
 * Тип **выводится из фактов, а не заявляется**: заявленный соврал бы в тот же день,
 * когда у предприятия сняли надзором последнюю точку (AR) или оно убрало товар с
 * онлайн-полки. Выводимое поле не расходится с действительностью по построению —
 * тот же приём, что `tokenizationReadiness` в BB и лестница товара в BM.
 */

export type CompanyMode = "online" | "offline" | "mixed" | "none";

export type CompanyModeInput = {
  /** Одобренные, не снятые надзором точки с координатами. */
  offlinePoints: number;
  /** Точки типа ONLINE — заведение без адреса. */
  onlinePoints: number;
  /** Онлайн-полки, на которых что-то есть (слайс BC). */
  onlineStockShelves: number;
};

export function companyMode(input: CompanyModeInput): CompanyMode {
  const offline = input.offlinePoints > 0;
  const online = input.onlinePoints > 0 || input.onlineStockShelves > 0;
  if (offline && online) return "mixed";
  if (offline) return "offline";
  if (online) return "online";
  // Ни точки, ни полки: предприятие завелось и ещё ничего о себе не сказало.
  // «Онлайн» тут было бы догадкой — сайт это не магазин.
  return "none";
}
