/**
 * Применение движения к остаткам. Жило внутри `src/app/actions/warehouses.ts`; вынесено
 * в слайсе BI, потому что ту же запись делает приёмка заказа поставщику: у остатка
 * **один автор**, и вторая копия правила разошлась бы с первой (прецедент — `editorCompany`
 * в BC).
 *
 * Проверка «хватает ли» делается по **получившемуся** числу внутри транзакции: проверка
 * «до» под двумя одновременными расходами пропускает оба, а `UPDATE … increment`
 * блокирует строку. Ушло в минус — вся транзакция откатывается.
 */
import { Prisma } from "@prisma/client";
import type { Delta, MoveKind } from "@/lib/warehouse/rules";

/** Остаток в минус ушёл уже после записи — значит гонка: откатываем всю транзакцию. */
export class NegativeBalance extends Error {}

export async function applyDeltas(
  tx: Prisma.TransactionClient,
  productId: string,
  deltas: readonly Delta[],
  kind: MoveKind,
) {
  for (const d of deltas) {
    const row = await tx.stockBalance.upsert({
      where: { warehouseId_productId: { warehouseId: d.warehouseId, productId } },
      create: { warehouseId: d.warehouseId, productId, qty: new Prisma.Decimal(d.delta) },
      update: { qty: { increment: new Prisma.Decimal(d.delta) } },
      select: { qty: true },
    });
    if (kind !== "ADJUST" && Number(row.qty) < 0) throw new NegativeBalance();
  }
}
