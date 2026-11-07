import { getTranslations } from "next-intl/server";
import { getProvenance } from "@/lib/coin-card-provenance";
import { resolveSubstrateChain } from "@/lib/substrate-chains";
import { ProvenanceBadge } from "./provenance-badge";

export type ChainFactsView = {
  chain: string;
  genesisHash: string;
  tokenSymbol: string | null;
  tokenDecimals: number | null;
  blockSeconds: number | null;
  blockSample: number | null;
  bestNumber: number | null;
  finalitySeconds: number | null;
  mismatches: string[];
  checkedAt: Date | string;
  checkError: string | null;
};

/**
 * Нативная монета своей сети: контракта нет, идентичность — хэш генезиса.
 * Тикер и знаки прочитаны из сети, время блока измерено на конкретном блоке —
 * поэтому номер блока показан рядом, а не спрятан: замер не вечная истина.
 */
export async function NativeChainBlock({
  nativeChain,
  facts,
  cardSymbol,
  provenance,
}: {
  nativeChain: string;
  facts: ChainFactsView | null;
  cardSymbol: string;
  provenance: unknown;
}) {
  const t = await getTranslations("coinCard.nativeChain");
  const chain = resolveSubstrateChain(nativeChain);
  const label = chain?.label ?? nativeChain;
  const verified = facts && !facts.checkError ? facts : null;

  return (
    <div className="border border-hairline rounded-md p-3 bg-card space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("title")}</span>
        <span className="text-[14px] font-medium">{label}</span>
        <span className="text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border border-accent/40 text-accent">
          {t("native")}
        </span>
      </div>

      {verified && (
        <dl className="space-y-1.5">
          {verified.tokenSymbol && (
            <Row
              label={t("symbol")}
              value={verified.tokenSymbol}
              path="chain.symbol"
              provenance={provenance}
            />
          )}
          {verified.tokenDecimals != null && (
            <Row
              label={t("decimals")}
              value={String(verified.tokenDecimals)}
              path="chain.decimals"
              provenance={provenance}
            />
          )}
          {verified.blockSeconds != null && (
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <dt className="text-[14px] text-muted">{t("blockTime")}</dt>
              <dd className="text-[14px] num">
                {t("seconds", { value: verified.blockSeconds })}
                {verified.bestNumber != null && (
                  <span className="text-muted text-xs ml-2">
                    {t("measuredAt", { block: verified.bestNumber.toLocaleString("en-US") })}
                  </span>
                )}
              </dd>
            </div>
          )}
          {verified.finalitySeconds != null && (
            <Row
              label={t("finality")}
              value={t("seconds", { value: verified.finalitySeconds })}
              path="payments.finalitySeconds"
              provenance={provenance}
            />
          )}
        </dl>
      )}

      {verified?.mismatches.includes("SYMBOL") && verified.tokenSymbol && (
        <p className="text-[13px] text-down">
          {t("symbolMismatch", { claimed: cardSymbol, actual: verified.tokenSymbol })}
        </p>
      )}

      {facts?.genesisHash && (
        <p className="font-mono text-xs break-all text-muted">
          {t("genesis")}: {facts.genesisHash}
        </p>
      )}

      {facts?.checkError && <p className="text-[13px] text-muted">{t(`error.${facts.checkError}`)}</p>}
    </div>
  );
}

function Row({
  label,
  value,
  path,
  provenance,
}: {
  label: string;
  value: string;
  path: string;
  provenance: unknown;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <dt className="text-[14px] text-muted">{label}</dt>
      <dd className="text-[14px] num">
        {value}
        <ProvenanceBadge entry={getProvenance(provenance, path)} />
      </dd>
    </div>
  );
}
