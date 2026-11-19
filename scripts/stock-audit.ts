/**
 * Сверка остатков: пересчёт из движений против записанного баланса.
 *
 * Баланс — свёртка движений, и он хранится (считать по миллиону движений на каждый показ
 * страницы нельзя). Значит нужна сверка, и она **печатает расхождение, а не исправляет
 * его молча**: расхождение означает дефект в коде движений, и затирание баланса скрыло бы
 * его от нас, оставив неверным сам код.
 *
 *   npx tsx scripts/stock-audit.ts [--company=<id>]
 */
import { prisma } from "../src/lib/prisma";

type Key = string; // `${warehouseId}|${productId}`

function key(warehouseId: string, productId: string): Key {
  return `${warehouseId}|${productId}`;
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--company="));
  const companyId = arg ? arg.slice("--company=".length) : undefined;

  const movements = await prisma.stockMovement.findMany({
    where: companyId ? { companyId } : {},
    select: {
      id: true,
      kind: true,
      status: true,
      qty: true,
      productId: true,
      fromWarehouseId: true,
      toWarehouseId: true,
    },
  });

  // Пересчёт повторяет те же правила, что `movementPlan`, но по записанному состоянию:
  // отменённое движение ничего не весит, транзит весит только списанием с источника.
  const computed = new Map<Key, number>();
  const add = (warehouseId: string | null, productId: string, delta: number) => {
    if (!warehouseId) return;
    const k = key(warehouseId, productId);
    computed.set(k, (computed.get(k) ?? 0) + delta);
  };

  for (const m of movements) {
    const qty = Number(m.qty);
    switch (m.kind) {
      case "RECEIPT":
      case "ADJUST":
        // Отмены у прихода и поправки не бывает: отменяется только то, что едет.
        if (m.status !== "CANCELLED") add(m.toWarehouseId, m.productId, qty);
        break;
      case "ISSUE":
        if (m.status !== "CANCELLED") add(m.fromWarehouseId, m.productId, -qty);
        break;
      case "TRANSFER":
        // Отменённое перемещение источник **уже списало** — отменить можно только то,
        // что отправлено (`IN_TRANSIT`), а возврат пришёл встречным приходом, который
        // в журнале стоит своей строкой. Пропусти отменённое целиком — и возврат
        // посчитается дважды: именно это поймал живой прогон слайса BC.
        add(m.fromWarehouseId, m.productId, -qty);
        if (m.status === "DONE") add(m.toWarehouseId, m.productId, qty);
        break;
    }
  }

  const balances = await prisma.stockBalance.findMany({
    where: companyId ? { warehouse: { companyId } } : {},
    select: {
      warehouseId: true,
      productId: true,
      qty: true,
      warehouse: { select: { name: true, companyId: true } },
      product: { select: { name: true } },
    },
  });

  let mismatches = 0;
  const seen = new Set<Key>();
  for (const b of balances) {
    const k = key(b.warehouseId, b.productId);
    seen.add(k);
    const expected = computed.get(k) ?? 0;
    const actual = Number(b.qty);
    // Три знака после запятой — предел самой колонки; сравниваем с тем же допуском.
    if (Math.abs(expected - actual) > 0.0005) {
      mismatches += 1;
      console.log(
        `MISMATCH ${b.warehouse.name} / ${b.product.name}: записано ${actual}, из движений ${expected}`,
      );
    }
  }
  // Строка, которой нет вовсе, а движения есть — тоже расхождение, и молчать о нём нельзя.
  for (const [k, expected] of computed) {
    if (seen.has(k) || Math.abs(expected) <= 0.0005) continue;
    mismatches += 1;
    console.log(`MISSING ${k}: из движений ${expected}, строки баланса нет`);
  }

  console.log(
    `сверено: ${balances.length} строк баланса, ${movements.length} движений; расхождений ${mismatches}`,
  );
  await prisma.$disconnect();
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
