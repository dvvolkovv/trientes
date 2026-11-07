import { getTranslations } from "next-intl/server";
import { getProvenance } from "@/lib/coin-card-provenance";
import { EMPTY_PAYMENTS, validatePayments } from "@/lib/coin-card-payments";
import { feeMismatch } from "@/lib/coin-card-chain-facts";
import { formatFeeAmount } from "@/lib/format";
import { ProvenanceBadge } from "../provenance-badge";
import { ExternalLink } from "../external-link";

/**
 * Платёжный профиль — то, что продавцу нужно знать прежде, чем принимать
 * монету. Каждая строка со своим бейджем провенанса: часть значений проект
 * заявляет сам, часть позже перезапишет воркер, читающий сеть (слайс B).
 *
 * «Возврат средств: невозможен» написано прямо и без смягчения: для продавца
 * это преимущество, для покупателя — риск, и обе стороны должны прочитать
 * одно и то же.
 *
 * Слайс S: для нативной монеты своей сети время блока и финальность измерены
 * на цепи. Факт вытесняет заявление в самой строке, но заявление не исчезает:
 * при расхождении больше 10% оно показывается рядом — правило слайса B «не
 * поправлять молча, а показывать расхождение».
 *
 * Слайс T: то же самое с комиссией — но она становится долларовым фактом
 * только вместе с ценой. Цены нет (у монеты нет рынков) — в строке остаётся
 * заявление проекта, а проверенная комиссия в монетах видна в блоке «Сеть
 * монеты», где доллары не нужны.
 */
export type ChainFactsPayments = {
  blockSeconds: number | null;
  finalitySeconds: number | null;
  transferFeeTokens: number | null;
  transferFeeError: string | null;
  checkError: string | null;
};

export async function PaymentsBlock({
  payments,
  provenance,
  chainFacts = null,
  priceUsd = null,
}: {
  payments: unknown;
  provenance: unknown;
  chainFacts?: ChainFactsPayments | null;
  /** Слайс T: без цены проверенная комиссия в доллары не переводится. */
  priceUsd?: number | null;
}) {
  const t = await getTranslations("coinCard.payments");
  const v = validatePayments(payments);
  const f = chainFacts && !chainFacts.checkError ? chainFacts : null;
  // Профиль проекта может быть пуст или невалиден — но если факты сети есть,
  // блок всё равно нужен: это ровно те числа, за которыми пришёл продавец.
  if (!v.ok && !f) return null;
  const d = v.ok ? v.data : EMPTY_PAYMENTS;

  const differs = (fact: number, claimed: number | null) =>
    claimed != null && claimed > 0 && Math.abs(fact - claimed) / claimed > 0.1;

  const rows: Array<{ label: string; value: string; path: string; aside: string | null }> = [];

  const finality = f?.finalitySeconds ?? d.finalitySeconds;
  if (finality !== null) {
    rows.push({
      label: t("finality"),
      value: t("seconds", { value: finality }),
      path: "payments.finalitySeconds",
      aside:
        f?.finalitySeconds != null && differs(f.finalitySeconds, d.finalitySeconds)
          ? t("claimedSays", { value: t("seconds", { value: d.finalitySeconds! }) })
          : null,
    });
  }

  const blockTime = f?.blockSeconds ?? d.blockSeconds;
  if (blockTime !== null) {
    rows.push({
      label: t("blockTime"),
      value: t("seconds", { value: blockTime }),
      path: "payments.blockSeconds",
      aside:
        f?.blockSeconds != null && differs(f.blockSeconds, d.blockSeconds)
          ? t("claimedSays", { value: t("seconds", { value: d.blockSeconds! }) })
          : null,
    });
  }
  const factFeeUsd =
    f?.transferFeeTokens != null && !f.transferFeeError && priceUsd != null && priceUsd > 0
      ? f.transferFeeTokens * priceUsd
      : null;
  const feeUsd = factFeeUsd ?? d.feeUsdTypical;
  if (feeUsd !== null) {
    rows.push({
      label: t("fee"),
      // Явный ноль, а не прочерк: сеть без комиссии — это факт, а не пропуск.
      value: feeUsd === 0 ? t("feeFree") : `$${formatFeeAmount(feeUsd)}`,
      path: "payments.feeUsdTypical",
      aside:
        factFeeUsd != null &&
        feeMismatch({
          declaredUsd: d.feeUsdTypical,
          factTokens: f?.transferFeeTokens ?? null,
          priceUsd,
        })
          ? t("claimedSays", {
              value:
                d.feeUsdTypical === 0 ? t("feeFree") : `$${formatFeeAmount(d.feeUsdTypical!)}`,
            })
          : null,
    });
  }
  if (d.tps !== null) {
    rows.push({
      label: t("tps"),
      value: t("tpsValue", { value: d.tps }),
      path: "payments.tps",
      aside: null,
    });
  }
  if (d.reversible !== null) {
    rows.push({
      label: t("reversible"),
      value: d.reversible ? t("reversibleYes") : t("reversibleNo"),
      path: "payments.reversible",
      aside: null,
    });
  }
  if (d.stablecoins.length > 0) {
    rows.push({
      label: t("stablecoins"),
      value: d.stablecoins.join(", "),
      path: "payments.stablecoins",
      aside: null,
    });
  }

  if (rows.length === 0 && d.integrations.length === 0 && !d.feeNote) return null;

  return (
    <div className="border border-hairline rounded-md p-5 space-y-4">
      <div className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("title")}</div>

      {rows.length > 0 && (
        <dl className="space-y-2">
          {rows.map((r) => (
            <div key={r.path} className="flex flex-wrap items-baseline justify-between gap-3">
              <dt className="text-[14px] text-muted">{r.label}</dt>
              <dd className="text-[14px] num">
                {r.value}
                <ProvenanceBadge entry={getProvenance(provenance, r.path)} />
                {r.aside && <span className="text-muted text-xs ml-2">{r.aside}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {d.feeNote && <p className="text-[13px] text-muted max-w-[70ch]">{d.feeNote}</p>}

      {d.integrations.length > 0 && (
        <div className="space-y-2">
          <div className="text-[12px] uppercase tracking-[0.15em] text-muted">
            {t("integrations")}
          </div>
          <div className="flex flex-wrap gap-2">
            {d.integrations.map((i) => (
              <span
                key={`${i.kind}-${i.name}`}
                className="inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md border border-hairline"
              >
                <span className="text-muted">{t(`kind.${i.kind}`)}</span>
                {i.url ? (
                  <ExternalLink href={i.url} className="text-accent">
                    {i.name}
                  </ExternalLink>
                ) : (
                  <span>{i.name}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {d.refundPolicyUrl && (
        <p className="text-[13px]">
          <ExternalLink href={d.refundPolicyUrl} className="text-accent">
            {t("refundPolicy")}
          </ExternalLink>
        </p>
      )}
    </div>
  );
}
