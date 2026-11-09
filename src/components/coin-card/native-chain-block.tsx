import { getTranslations } from "next-intl/server";
import { formatFeeAmount } from "@/lib/format";
import { resolveBitcoinChain } from "@/lib/bitcoin-chains";
import { getProvenance } from "@/lib/coin-card-provenance";
import { resolveCosmosChain } from "@/lib/cosmos-chains";
import { resolveEvmChain } from "@/lib/evm-chains";
import { resolveSubstrateChain } from "@/lib/substrate-chains";
import { ProvenanceBadge } from "./provenance-badge";

export type ChainFactsView = {
  chain: string;
  family?: string;
  genesisHash: string | null;
  chainId?: string | null;
  minGasPrice?: string | null;
  tokenSymbol: string | null;
  tokenDecimals: number | null;
  blockSeconds: number | null;
  blockSample: number | null;
  bestNumber: number | null;
  finalitySeconds: number | null;
  transferFeeTokens: number | null;
  transferFeeError: string | null;
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
  priceUsd = null,
  networkSupply = null,
}: {
  nativeChain: string;
  facts: ChainFactsView | null;
  cardSymbol: string;
  provenance: unknown;
  priceUsd?: number | null;
  /**
   * Выпуск, прочитанный в этой сети, когда он не годится как выпуск монеты
   * (`supply_share`): в разделе токеномики его показывать нельзя — он там
   * означал бы выпуск монеты, — а как факт сети он на месте.
   */
  networkSupply?: string | null;
}) {
  const t = await getTranslations("coinCard.nativeChain");
  const substrate = resolveSubstrateChain(nativeChain);
  const cosmos = substrate ? null : resolveCosmosChain(nativeChain);
  const bitcoin = substrate || cosmos ? null : resolveBitcoinChain(nativeChain);
  const evm = substrate || cosmos || bitcoin ? null : resolveEvmChain(nativeChain);
  const label =
    substrate?.label ?? cosmos?.label ?? bitcoin?.label ?? evm?.label ?? nativeChain;
  const verified = facts && !facts.checkError ? facts : null;
  // Ноль секунд финализации — это «окончателен в момент включения»: верно по
  // числу и непонятно по смыслу. Решается по значению, а не по семье: так
  // отвечают и Cosmos, и половина сетей EVM (Cronos, Sonic, Hyperliquid).
  const instantFinality = facts?.finalitySeconds === 0;
  // В PoW окончательности нет вовсе: вероятность переписывания лишь падает с
  // подтверждениями. Соглашение «шесть подтверждений» принадлежит получателю, а
  // не сети, поэтому числа здесь нет — есть время блока выше, из которого
  // читатель считает своё.
  const probabilisticFinality = facts?.family === "BITCOIN";

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
              value={
                instantFinality
                  ? t("finalityInstant")
                  : t("seconds", { value: verified.finalitySeconds })
              }
              path="payments.finalitySeconds"
              provenance={provenance}
            />
          )}
          {probabilisticFinality && verified.finalitySeconds == null && (
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <dt className="text-[14px] text-muted">{t("finality")}</dt>
              <dd className="text-[14px]">{t("finalityProbabilistic")}</dd>
            </div>
          )}
          {/* Комиссию перевода этой семье пока никто не считает: узел сообщает
              только минимальную цену газа — показываем как есть, с базовым
              деномом, в котором узел её и назвал (0.002 utia за единицу газа). */}
          {verified.minGasPrice && (
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <dt className="text-[14px] text-muted">{t("minGasPrice")}</dt>
              <dd className="text-[14px] num">
                {verified.minGasPrice}
                {cosmos ? ` ${cosmos.denom}` : ""}
                <span className="text-muted text-xs ml-2">{t("feeNotMeasured")}</span>
              </dd>
            </div>
          )}
          {/* Комиссию считает сам узел для эталонного перевода одной монеты —
              поэтому подпись говорит, что именно измерено, а не «типичная». */}
          {verified.transferFeeTokens != null && !verified.transferFeeError && (
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <dt className="text-[14px] text-muted">{t("transferFee")}</dt>
              <dd className="text-[14px] num">
                {verified.transferFeeTokens === 0
                  ? t("transferFeeFree")
                  : `${formatFeeAmount(verified.transferFeeTokens)} ${
                      verified.tokenSymbol ?? cardSymbol
                    }`}
                {priceUsd != null && priceUsd > 0 && verified.transferFeeTokens > 0 && (
                  <span className="text-muted text-xs ml-2 num">
                    ≈ ${formatFeeAmount(verified.transferFeeTokens * priceUsd)}
                  </span>
                )}
                <span className="text-muted text-xs ml-2">
                  {probabilisticFinality
                    ? t("transferFeeHintUtxo")
                    : facts?.family === "EVM"
                      ? t("transferFeeHintEvm")
                      : t("transferFeeHint")}
                </span>
              </dd>
            </div>
          )}
        </dl>
      )}

      {networkSupply && (
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <dt className="text-[14px] text-muted">{t("supplyHere")}</dt>
          <dd className="text-[14px] num">
            {networkSupply}
            <span className="text-muted text-xs ml-2">{t("supplyHereHint")}</span>
          </dd>
        </div>
      )}

      {verified?.mismatches.includes("SYMBOL") && verified.tokenSymbol && (
        <p className="text-[13px] text-down">
          {t("symbolMismatch", { claimed: cardSymbol, actual: verified.tokenSymbol })}
        </p>
      )}

      {/* У EVM есть и то и другое: chainId — идентичность, хэш генезиса —
          дополнительная проверка там, где узел отдаёт блок 0. */}
      {facts?.chainId && (
        <p className="font-mono text-xs break-all text-muted">
          {t("chainId")}: {facts.chainId}
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
