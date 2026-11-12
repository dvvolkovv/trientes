/**
 * Каталог монет с опорной ценой — последним снимком каждой монеты.
 *
 * Почему сырым запросом, а не связью Prisma: `snapshots: { take: 1 }` по двум
 * сотням монет на таблице в 450 тысяч снимков занимает шесть секунд и триста
 * мегабайт — живой замер на проде, после которого pm2 убивал веб по памяти.
 * Боковое соединение (`LEFT JOIN LATERAL`) по индексу `(coinId, fetchedAt)`
 * отвечает мгновенно. Тот же приём уже применён в `readTop100` по той же
 * причине.
 */

import { prisma } from "@/lib/prisma";
import type { CoinCandidate } from "@/lib/exchange-coins";

type Row = {
  id: string;
  symbol: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  priceUsd: unknown;
  fetchedAt: Date | null;
};

/** Монеты каталога по рангу, каждая со своей последней ценой (или без неё). */
export async function catalogWithReferences(limit = 500): Promise<CoinCandidate[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT c.id, c.symbol, c.name, c.slug, c."logoUrl", s."priceUsd", s."fetchedAt"
    FROM "Coin" AS c
    LEFT JOIN LATERAL (
      SELECT snap."priceUsd", snap."fetchedAt"
      FROM "CoinSnapshot" AS snap
      WHERE snap."coinId" = c.id
      ORDER BY snap."fetchedAt" DESC
      LIMIT 1
    ) AS s ON TRUE
    WHERE c."isActive" = true
    ORDER BY c."rank" ASC
    LIMIT ${limit}
  `;

  return rows.map((r) => {
    // `Decimal` приходит объектом: строка — единственный безопасный путь к числу.
    const priceUsd = r.priceUsd == null ? NaN : Number(String(r.priceUsd));
    return {
      id: r.id,
      symbol: r.symbol,
      name: r.name,
      slug: r.slug,
      logoUrl: r.logoUrl,
      reference:
        r.fetchedAt && Number.isFinite(priceUsd) && priceUsd > 0
          ? { priceUsd, fetchedAt: r.fetchedAt }
          : null,
    };
  });
}
