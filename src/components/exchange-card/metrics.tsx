import { getTranslations, getLocale } from "next-intl/server";
import type { Exchange } from "@/lib/coingecko";

function fmtUsd(n: number): string {
  if (n <= 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function relativeAgo(now: number, then: number, t: (key: string, vals?: Record<string, number>) => string): string {
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 30) return t("freshness.justNow");
  if (sec < 60) return t("freshness.secAgo", { n: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t("freshness.minAgo", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("freshness.hourAgo", { n: hr });
  const day = Math.floor(hr / 24);
  return t("freshness.dayAgo", { n: day });
}

export async function ExchangeCardMetrics({
  exchange,
  fetchedAt,
  liveVolume24hUsd,
}: {
  exchange: Exchange;
  fetchedAt: Date;
  liveVolume24hUsd?: number | null;
}) {
  const t = await getTranslations("exchangeCard");
  await getLocale();
  const vol = liveVolume24hUsd ?? exchange.volume24hUsd;
  const now = Date.now();
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[15px] font-semibold">{t("metrics.title")}</h2>
        <span className="text-[11px] text-muted">
          {t("freshness.updated", { ago: relativeAgo(now, fetchedAt.getTime(), t) })}
        </span>
      </div>
      <div className="bg-card border border-hairline rounded-[16px] p-5 grid grid-cols-2 gap-5">
        <div>
          <div className="text-muted text-[11px] uppercase tracking-[0.18em] mb-1">{t("metrics.volume24h")}</div>
          <div className="num text-[20px] font-semibold">{fmtUsd(vol)}</div>
          {exchange.volume24hBtc > 0 && (
            <div className="num text-[12px] text-muted mt-1">{exchange.volume24hBtc.toFixed(2)} BTC</div>
          )}
        </div>
        <div>
          <div className="text-muted text-[11px] uppercase tracking-[0.18em] mb-1">{t("metrics.trustScore")}</div>
          <div className="num text-[20px] font-semibold">{exchange.trustScore ?? t("noData")}/10</div>
        </div>
      </div>
    </section>
  );
}
