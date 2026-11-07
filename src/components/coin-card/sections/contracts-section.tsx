import { getTranslations } from "next-intl/server";
import { getProvenance } from "@/lib/coin-card-provenance";
import { ProvenanceBadge } from "../provenance-badge";
import { ExternalLink } from "../external-link";
import { OnchainSummary, type OnchainContract } from "../onchain-summary";
import { NativeChainBlock, type ChainFactsView } from "../native-chain-block";

type Contract = OnchainContract & {
  id: string;
  chain: string;
  address: string;
  decimals: number | null;
  standard: string | null;
  explorerUrl: string | null;
  isCanonical: boolean;
  verifiedAt: Date | string | null;
};

export async function ContractsSection({
  contracts,
  provenance,
  cardName,
  cardSymbol,
  nativeChain = null,
  chainFacts = null,
}: {
  contracts: Contract[];
  provenance: unknown;
  cardName: string;
  cardSymbol: string;
  /** Слайс S: нативная монета своей сети — контракта у неё нет. */
  nativeChain?: string | null;
  chainFacts?: ChainFactsView | null;
}) {
  const t = await getTranslations("coinCard");
  // У нативной монеты список контрактов пуст, но раздел всё равно нужен: в нём
  // живёт ответ на тот же вопрос «где эта монета».
  if (contracts.length === 0 && !nativeChain) return null;

  return (
    <section id="contracts" className="scroll-mt-24">
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">
        {t("sections.contracts")}
        <ProvenanceBadge entry={getProvenance(provenance, "contracts")} />
      </h2>
      <div className="space-y-3">
        {nativeChain && (
          <NativeChainBlock
            nativeChain={nativeChain}
            facts={chainFacts}
            cardSymbol={cardSymbol}
            provenance={provenance}
          />
        )}
        {contracts.map((c) => (
          <div key={c.id} className="border border-hairline rounded-md p-3 bg-card">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12px] uppercase tracking-[0.15em] text-muted">{c.chain}</span>
              {c.isCanonical && (
                <span className="text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border border-accent/40 text-accent">
                  {t("canonical")}
                </span>
              )}
              {c.standard && <span className="text-muted text-xs">{c.standard}</span>}
              {c.decimals != null && <span className="text-muted text-xs">dec {c.decimals}</span>}
              {c.verifiedAt && <span className="text-up text-xs">{t("contractVerified")}</span>}
            </div>
            <p className="font-mono text-xs break-all mt-2">{c.address}</p>
            <ExternalLink href={c.explorerUrl} className="text-accent text-xs mt-1 inline-block">
              {t("openInExplorer")}
            </ExternalLink>
            <OnchainSummary contract={c} claimedName={cardName} claimedSymbol={cardSymbol} />
          </div>
        ))}
      </div>
    </section>
  );
}
