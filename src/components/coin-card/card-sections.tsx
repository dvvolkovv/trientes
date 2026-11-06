import type { PublicCoinCard } from "@/lib/coin-card-public";
import { ContractsSection } from "./sections/contracts-section";
import { TokenomicsSection } from "./sections/tokenomics-section";
import { MarketsSection } from "./sections/markets-section";
import { SecuritySection } from "./sections/security-section";
import { TeamSection } from "./sections/team-section";
import { MarketingSection } from "./sections/marketing-section";
import { CardLinksSection } from "./sections/links-section";

/**
 * The project-supplied half of a coin page. Mounted both on top of an
 * existing Coin page and standalone, for cards that have no external feed
 * behind them at all.
 */
export function CoinCardSections({ card }: { card: PublicCoinCard }) {
  return (
    <>
      <ContractsSection contracts={card.contracts} provenance={card.provenance} />
      <TokenomicsSection tokenomics={card.tokenomics} provenance={card.provenance} />
      <MarketsSection markets={card.markets} provenance={card.provenance} />
      <SecuritySection security={card.security} />
      <TeamSection teamInfo={card.teamInfo} />
      <MarketingSection marketing={card.marketing} />
      <CardLinksSection links={card.links} />
    </>
  );
}
