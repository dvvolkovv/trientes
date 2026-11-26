/**
 * Применение движения к остаткам. Жило внутри `src/app/actions/warehouses.ts`; вынесено
 * в слайсе BI, потому что ту же запись делает приёмка заказа поставщику: у остатка
 * **один автор**, и вторая копия правила разошлась бы с первой (прецедент — `editorCompany`
 * в BC).
 *
 * Проверка «хватает ли» делается по **получившемуся** числу внутри транзакции: проверка
 * «до» под двумя одновременными расходами пропускает оба, а `UPDATE … increment`
 * блокирует строку. Ушло в минус — вся транзакция откатывается.
 *
 * Возвращает получившиеся числа (слайс CO): по ним считается пересечение порога остатка,
 * и второго запроса в базу для этого не нужно — «до» это `after - delta`. Автор остатка
 * один, значит и число «после» должно приходить от него.
 */
import { Prisma } from "@prisma/client";
import type { Delta, MoveKind } from "@/lib/warehouse/rules";

/** Остаток в минус ушёл уже после записи — значит гонка: откатываем всю транзакцию. */
export class NegativeBalance extends Error {}

export type AppliedDelta = { warehouseId: string; productId: string; delta: number; after: number };

export async function applyDeltas(
  tx: Prisma.TransactionClient,
  productId: string,
  deltas: readonly Delta[],
  kind: MoveKind,
): Promise<AppliedDelta[]> {
  const applied: AppliedDelta[] = [];
  for (const d of deltas) {
    const row = await tx.stockBalance.upsert({
      where: { warehouseId_productId: { warehouseId: d.warehouseId, productId } },
      create: { warehouseId: d.warehouseId, productId, qty: new Prisma.Decimal(d.delta) },
      update: { qty: { increment: new Prisma.Decimal(d.delta) } },
      select: { qty: true },
    });
    if (kind !== "ADJUST" && Number(row.qty) < 0) throw new NegativeBalance();
    applied.push({ warehouseId: d.warehouseId, productId, delta: d.delta, after: Number(row.qty) });
  }
  return applied;
}
