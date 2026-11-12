import Image from "next/image";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { redis } from "@/lib/redis";
import { connectorForDirectory } from "@/lib/cex-registry";
import { getSnapshots } from "@/lib/cex-snapshot";
import { matchExchangeCoins } from "@/lib/exchange-coins";
import { catalogWithReferences } from "@/lib/coin-reference";
import { formatCompact, formatPercent, formatPrice } from "@/lib/format";
import { relativeAgo } from "@/lib/relative-ago";

/** Сколько монет каталога спрашиваем у снимка: весь каталог и есть предел. */
const CATALOG_LIMIT = 500;

/**
 * Монеты, которыми торгует биржа. Источник — снимок её тикеров, а не наша
 * база: `ExchangeMarket` наполняли детальные вызовы CoinPaprika, и в проде эта
 * таблица пуста по всем биржам.
 *
 * Раздел есть только у бирж, к которым у нас есть коннектор: у остальных мы
 * список честно не знаем, и выдумывать его незачем.
 */
export async function ExchangeCardCoins({ exchangeId }: { exchangeId: string }) {
  const connector = connectorForDirectory(exchangeId);
  if (!connector) return null;

  const t = await getTranslations("exchangeCard");
  const locale = await getLocale();

  const [snapshots, candidates] = await Promise.all([
    getSnapshots([connector.id], { redis }),
    catalogWithReferences(CATALOG_LIMIT),
  ]);

  const snapshot = snapshots.get(connector.id);
  if (!snapshot || "error" in snapshot) {
    // Биржа не ответила. Это наша связь, а не её листинг: говорим об этом и не
    // показываем пустой список как «монет нет».
    return (
      <section>
        <h2 className="text-[15px] font-semibold mb-3">{t("coins.title")}</h2>
        <div className="bg-card border border-hairline rounded-[16px] p-5 text-[13px] text-muted">
          {t("coins.unreachable")}
        </div>
      </section>
    );
  }

  // Часы читаем один раз за рендер: и охранник опоры, и подпись свежести
  // должны говорить об одном и том же мгновении.
  const now = new Date();
  const { rows, unverified } = matchExchangeCoins(connector, snapshot.tickers, candidates, now);
  if (rows.length === 0 && unverified === 0) return null;

  const fetchedAt = new Date(snapshot.fetchedAt).getTime();
  const changeClass = (pct: number | null) =>
    pct == null ? "text-muted" : pct >= 0 ? "text-up" : "text-down";

  const coinCell = (r: (typeof rows)[number]) => (
    <Link
      href={`/${locale}/coin/${r.slug}`}
      className="inline-flex items-center gap-2 min-w-0 hover:text-accent transition-colors"
    >
      {/* Место под знак занято всегда: у части монет логотипа нет, и без
          заглушки их имена сдвигаются влево относительно соседних строк. */}
      {r.logoUrl ? (
        <Image
          src={r.logoUrl}
          alt=""
          width={20}
          height={20}
          className="rounded-full shrink-0"
          unoptimized
        />
      ) : (
        <span className="w-5 h-5 shrink-0 rounded-full bg-bg-tint border border-hairline" />
      )}
      <span className="font-medium truncate">{r.name}</span>
      <span className="text-muted text-[11px] uppercase shrink-0">{r.symbol}</span>
    </Link>
  );

  const pairCell = (r: (typeof rows)[number]) => (
    <span className="num whitespace-nowrap">
      {r.pair}
      {r.pairs > 1 && (
        <span className="text-muted text-[11px]" title={t("coins.pairsCount", { count: r.pairs })}>
          {" "}
          ·{r.pairs}
        </span>
      )}
    </span>
  );

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-[15px] font-semibold">{t("coins.title")}</h2>
        <span className="text-[11px] text-muted">
          {t("freshness.updated", { ago: relativeAgo(now.getTime(), fetchedAt, t) })}
        </span>
      </div>

      <div className="bg-card border border-hairline rounded-[16px] overflow-hidden">
        <div className="px-4 py-3 border-b border-hairline text-[12px] text-muted">
          {t("coins.count", { count: rows.length })}
        </div>

        {/* Широкий экран — таблица, телефон — строка на монету: семь колонок на
            узком экране читаются только боковой прокруткой, а её на сайте нет. */}
        <table className="hidden sm:table w-full text-[13px] table-fixed">
          <thead>
            <tr className="text-muted text-[11px] uppercase tracking-[0.14em] border-b border-hairline">
              <th className="text-left px-4 py-3 font-medium w-[38%]">{t("coins.columns.coin")}</th>
              <th className="text-center px-3 py-3 font-medium w-[18%]">{t("coins.columns.pair")}</th>
              <th className="text-right px-3 py-3 font-medium w-[16%]">{t("coins.columns.price")}</th>
              <th className="text-right px-3 py-3 font-medium w-[12%]">{t("coins.columns.change24h")}</th>
              <th className="text-right px-4 py-3 font-medium w-[16%]">{t("coins.columns.volume24h")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-bg-tint/60 transition-colors">
                <td className="px-4 py-3 truncate">{coinCell(r)}</td>
                <td className="px-3 py-3 text-center">{pairCell(r)}</td>
                <td className="px-3 py-3 text-right num whitespace-nowrap">{formatPrice(r.priceUsd)}</td>
                <td className={`px-3 py-3 text-right num ${changeClass(r.changePct)}`}>
                  {r.changePct != null ? formatPercent(r.changePct) : "—"}
                </td>
                <td className="px-4 py-3 text-right num whitespace-nowrap">
                  {r.volumeUsd24h != null ? formatCompact(r.volumeUsd24h) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="sm:hidden divide-y divide-hairline">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-[13px]">{coinCell(r)}</span>
                <span className="num text-[13px] shrink-0">{formatPrice(r.priceUsd)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-[11px]">
                <span className="text-muted">{pairCell(r)}</span>
                <span className="flex items-center gap-2">
                  <span className={`num ${changeClass(r.changePct)}`}>
                    {r.changePct != null ? formatPercent(r.changePct) : "—"}
                  </span>
                  <span className="num text-muted">
                    {r.volumeUsd24h != null ? formatCompact(r.volumeUsd24h) : "—"}
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-2 text-[11px] text-muted leading-relaxed">
        {t("coins.note")}
        {unverified > 0 && ` ${t("coins.unverified", { count: unverified })}`}
      </p>
    </section>
  );
}
