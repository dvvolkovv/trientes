import { getTranslations } from "next-intl/server";
import { getProvenance } from "@/lib/coin-card-provenance";
import { validatePayments } from "@/lib/coin-card-payments";
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
 */
export async function PaymentsBlock({
  payments,
  provenance,
}: {
  payments: unknown;
  provenance: unknown;
}) {
  const t = await getTranslations("coinCard.payments");
  const v = validatePayments(payments);
  if (!v.ok) return null;
  const d = v.data;

  const rows: Array<{ label: string; value: string; path: string }> = [];
  if (d.finalitySeconds !== null) {
    rows.push({
      label: t("finality"),
      value: t("seconds", { value: d.finalitySeconds }),
      path: "payments.finalitySeconds",
    });
  }
  if (d.blockSeconds !== null) {
    rows.push({
      label: t("blockTime"),
      value: t("seconds", { value: d.blockSeconds }),
      path: "payments.blockSeconds",
    });
  }
  if (d.feeUsdTypical !== null) {
    rows.push({
      label: t("fee"),
      // Явный ноль, а не прочерк: сеть без комиссии — это факт, а не пропуск.
      value: d.feeUsdTypical === 0 ? t("feeFree") : `$${d.feeUsdTypical}`,
      path: "payments.feeUsdTypical",
    });
  }
  if (d.tps !== null) {
    rows.push({ label: t("tps"), value: t("tpsValue", { value: d.tps }), path: "payments.tps" });
  }
  if (d.reversible !== null) {
    rows.push({
      label: t("reversible"),
      value: d.reversible ? t("reversibleYes") : t("reversibleNo"),
      path: "payments.reversible",
    });
  }
  if (d.stablecoins.length > 0) {
    rows.push({
      label: t("stablecoins"),
      value: d.stablecoins.join(", "),
      path: "payments.stablecoins",
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
