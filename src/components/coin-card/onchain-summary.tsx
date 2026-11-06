import { getTranslations } from "next-intl/server";
import { totalSupplyInCoins } from "@/lib/coin-card-onchain";

export type OnchainContract = {
  chain: string;
  decimals: number | null;
  onchainName: string | null;
  onchainSymbol: string | null;
  onchainDecimals: number | null;
  onchainTotalSupply: string | null;
  onchainFlags: string[];
  mismatches: string[];
  checkedAt: Date | string | null;
  checkError: string | null;
  verifiedAt: Date | string | null;
};

const fmt = (n: number | null) =>
  n == null ? null : new Intl.NumberFormat("en-US").format(Math.round(n));

function day(value: Date | string | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Сводка сверки контракта с сетью. Заявление проекта остаётся выше без
 * изменений — здесь говорится только то, что ответила сеть, и если оно
 * разошлось, то обе версии стоят рядом.
 */
export async function OnchainSummary({
  contract,
  claimedName,
  claimedSymbol,
}: {
  contract: OnchainContract;
  claimedName: string;
  claimedSymbol: string;
}) {
  const t = await getTranslations("coinCard.onchain");
  const checked = day(contract.checkedAt);
  if (!checked) {
    return <p className="text-xs text-muted mt-2">{t("never")}</p>;
  }

  const supply = fmt(
    totalSupplyInCoins(contract.onchainTotalSupply, contract.onchainDecimals),
  );
  const mismatchText = (code: string): string => {
    if (code === "SYMBOL") {
      return t("mismatch.SYMBOL", {
        onchain: contract.onchainSymbol ?? "—",
        claimed: claimedSymbol,
      });
    }
    if (code === "NAME") {
      return t("mismatch.NAME", { onchain: contract.onchainName ?? "—", claimed: claimedName });
    }
    if (code === "DECIMALS") {
      return t("mismatch.DECIMALS", {
        onchain: String(contract.onchainDecimals ?? "—"),
        claimed: String(contract.decimals ?? "—"),
      });
    }
    return t("mismatch.TOTAL_SUPPLY", { onchain: supply ?? "—" });
  };

  return (
    <div className="mt-3 pt-3 border-t border-hairline space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted">{t("title")}</span>
        <span className="num text-[11px] text-muted">{checked}</span>
      </div>

      {contract.checkError ? (
        <p
          className={`text-xs ${
            contract.checkError === "not_a_contract" || contract.checkError === "not_erc20"
              ? "text-down"
              : "text-muted"
          }`}
        >
          {t(`error.${contract.checkError}`)}
        </p>
      ) : contract.mismatches.length > 0 ? (
        <ul className="space-y-1">
          {contract.mismatches.map((code) => (
            <li key={code} className="text-xs text-down">
              {mismatchText(code)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-up">{t("matches")}</p>
      )}

      {supply ? (
        <p className="text-xs text-muted">
          {t("supply")}: <span className="num text-foreground">{supply}</span>{" "}
          {contract.onchainSymbol ?? claimedSymbol}
        </p>
      ) : null}

      {contract.onchainFlags.length > 0 ? (
        <p className="text-xs text-muted">
          {t("flags")}: {contract.onchainFlags.map((f) => t(`flag.${f}`)).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
