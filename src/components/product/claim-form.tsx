"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { submitProductClaim } from "@/app/actions/products";

export type ClaimCompany = { id: string; name: string };

/**
 * Выбор предприятия и доказательство словами. Выбор нужен потому, что у человека может
 * быть несколько предприятий, и молча взять первое значило бы решить за него.
 */
export function ClaimProductForm({
  productId,
  companies,
  locale,
}: {
  productId: string;
  companies: ClaimCompany[];
  locale: string;
}) {
  const t = useTranslations("products");
  const router = useRouter();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      {companies.length > 1 ? (
        <label className="block space-y-1">
          <span className="text-[12px] uppercase tracking-[0.14em] text-muted">{t("claim.companyLabel")}</span>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block space-y-1">
        <span className="text-[12px] uppercase tracking-[0.14em] text-muted">{t("claim.evidenceLabel")}</span>
        <textarea
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder={t("claim.evidencePlaceholder")}
          className="w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm"
        />
      </label>

      <button
        type="button"
        disabled={pending || !companyId}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await submitProductClaim(companyId, productId, evidence);
            if (r.ok) {
              router.push(`/${locale}/cabinet/companies/${companyId}/products`);
              router.refresh();
            } else {
              setError(r.reason);
            }
          });
        }}
        className="w-full h-12 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
      >
        {pending ? t("claim.sending") : t("claim.submit")}
      </button>
      {error ? <p className="text-red-500 text-[13px]">{t(`claim.error.${error}`)}</p> : null}
    </div>
  );
}
