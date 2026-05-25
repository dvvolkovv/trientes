"use client";

import { useState, useTransition } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createCompany } from "@/app/actions/company";

export function CreateCompanyForm() {
  const t = useTranslations("cabinet.companies");
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const [pending, startTransition] = useTransition();
  const [legalName, setLegalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await createCompany({ legalName, displayName });
          if (r.ok) router.push(`/${locale}/cabinet/companies/${r.id}`);
          else setError(r.reason);
        });
      }}
    >
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">{t("add")}</h3>
      <input
        value={legalName}
        onChange={(e) => setLegalName(e.target.value)}
        placeholder={t("legalName")}
        className="w-full px-3 py-2 rounded-md border border-hairline bg-card"
      />
      <input
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder={t("displayName")}
        className="w-full px-3 py-2 rounded-md border border-hairline bg-card"
      />
      {error && <p className="text-red-500 text-sm">{t(`errors.${error}`)}</p>}
      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 rounded-md bg-blue text-blue-foreground font-medium disabled:opacity-50"
      >
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
