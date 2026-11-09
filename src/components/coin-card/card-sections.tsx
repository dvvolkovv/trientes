import type { PublicCoinCard } from "@/lib/coin-card-public";
import { ContractsSection } from "./sections/contracts-section";
import { TokenomicsSection } from "./sections/tokenomics-section";
import { MarketsSection } from "./sections/markets-section";
import { AcceptanceSection } from "./sections/acceptance-section";
import { LegalSection } from "./sections/legal-section";
import { SecuritySection } from "./sections/security-section";
import { TeamSection } from "./sections/team-section";
import { MarketingSection } from "./sections/marketing-section";
import { CardLinksSection } from "./sections/links-section";
import { CardHistorySection } from "./history-section";
import { TranslatedBadge } from "./translated-badge";

/**
 * The project-supplied half of a coin page. Mounted both on top of an
 * existing Coin page and standalone, for cards that have no external feed
 * behind them at all.
 */
export function CoinCardSections({
  card,
  translated = false,
  originalHref,
  fallbackPriceUsd = null,
}: {
  card: PublicCoinCard;
  translated?: boolean;
  originalHref?: string;
  /**
   * Цена со страницы монеты. Нужна посеянной карточке (слайс V): собственного
   * ценового индекса у неё нет — рынков ей никто не заявлял, — а комиссию
   * перевода без цены не перевести в доллары.
   */
  fallbackPriceUsd?: number | null;
}) {
  const badge = translated && originalHref
    ? <TranslatedBadge originalHref={originalHref} />
    : null;
  const priceUsd = card.priceIndex?.priceUsd ?? fallbackPriceUsd;
  return (
    <>
      <ContractsSection
        contracts={card.contracts}
        provenance={card.provenance}
        cardName={card.name}
        cardSymbol={card.symbol}
        nativeChain={card.nativeChain}
        chainFacts={card.chainFacts}
        priceUsd={priceUsd}
        networkSupply={
          card.supply?.checkError === "supply_share" ? card.supply.totalSupply : null
        }
      />
      <TokenomicsSection
        tokenomics={card.tokenomics}
        provenance={card.provenance}
        supply={card.supply}
        badge={badge}
      />
      <MarketsSection markets={card.markets} provenance={card.provenance} />
      <AcceptanceSection
        cardId={card.id}
        slug={card.slug}
        symbol={card.symbol}
        payments={card.payments}
        provenance={card.provenance}
        chainFacts={card.chainFacts}
        priceUsd={priceUsd}
      />
      <LegalSection legal={card.legal} />
      <SecuritySection security={card.security} />
      <TeamSection teamInfo={card.teamInfo} />
      <MarketingSection marketing={card.marketing} badge={badge} />
      <CardLinksSection links={card.links} />
      <CardHistorySection cardId={card.id} />
    </>
  );
}
