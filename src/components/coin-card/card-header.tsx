import { getTranslations } from "next-intl/server";
import { getProvenance } from "@/lib/coin-card-provenance";
import type { PublicCoinCard } from "@/lib/coin-card-public";
import { ProvenanceBadge } from "./provenance-badge";
import { PriceIndexBlock } from "./price-index-block";
import { DexCandlesChart } from "./dex-candles-chart";
import { isOwnDexMarket } from "@/lib/coin-card-dex-market";
import { dexPairKey } from "@/lib/dex-candles";

export async function CoinCardHeader({ card }: { card: PublicCoinCard }) {
  const t = await getTranslations("coinCard");
  // Ряд свечей ведёт служба заявок нашего обмена, и он есть только у пары,
  // которой на обмене торгуют. Признак тот же, что у цены: рынок наш.
  const ownDex = card.markets.find((m) => isOwnDexMarket(m));
  const pairKey = ownDex ? dexPairKey(ownDex.pair) : null;
  return (
    <header>
      <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">
        {t("selfListed")}
      </div>
      <div className="flex items-center gap-4">
        {card.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.logoUrl} alt="" width={56} height={56}
            className="rounded-full border border-hairline" />
        )}
        <div>
          <h1 className="text-[28px] sm:text-[36px] md:text-[48px] font-bold tracking-[-0.035em]">
            {card.name}{" "}
            <span className="text-muted">{card.symbol}</span>
            <ProvenanceBadge entry={getProvenance(card.provenance, "symbol")} />
          </h1>
          {card.tagline && <p className="text-muted mt-1">{card.tagline}</p>}
        </div>
      </div>
      {/* Цена показывается только там, где наш индекс — единственный источник:
          у монет, привязанных к CoinGecko, цену даёт общая таблица Coin. */}
      {card.priceIndex && card.coinId == null && (
        <PriceIndexBlock index={card.priceIndex} provenance={card.provenance} />
      )}
      {pairKey && <DexCandlesChart pairKey={pairKey} />}
      {card.tags.length > 0 && (
        <ul className="flex flex-wrap gap-2 mt-4">
          {card.tags.map((tag) => (
            <li key={tag}
              className="text-[11px] uppercase tracking-[0.12em] border border-hairline rounded px-2 py-0.5 text-muted">
              {tag}
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}
