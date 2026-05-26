import { getTranslations } from "next-intl/server";
import type { Exchange } from "@/lib/coingecko";

function fmtUsd(n: number): string {
  if (n <= 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

export async function ExchangeCardMetrics({ exchange }: { exchange: Exchange }) {
  const t = await getTranslations("exchangeCard");
  return (
    <section>
      <h2 className="text-[15px] font-semibold mb-3">{t("metrics.title")}</h2>
      <div className="bg-card border border-hairline rounded-[16px] p-5 grid grid-cols-2 gap-5">
        <div>
          <div className="text-muted text-[11px] uppercase tracking-[0.18em] mb-1">{t("metrics.volume24h")}</div>
          <div className="num text-[20px] font-semibold">{fmtUsd(exchange.volume24hUsd)}</div>
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
