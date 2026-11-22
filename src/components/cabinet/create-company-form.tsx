"use client";

import { useState, useTransition } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createCompany } from "@/app/actions/company";

export function CreateCompanyForm({ nextCard }: { nextCard?: string }) {
  const t = useTranslations("cabinet.companies");
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const [pending, startTransition] = useTransition();
  const [legalName, setLegalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3 rounded-[22px] border border-hairline bg-card p-4 md:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await createCompany({ legalName, displayName });
          if (r.ok) {
            // Человек пришёл с карточки монеты — не теряем её по пути:
            // сразу открываем форму точки с уже отмеченной монетой.
            router.push(
              nextCard
                ? `/${locale}/cabinet/companies/${r.id}/points?card=${encodeURIComponent(nextCard)}#add-point`
                : `/${locale}/cabinet/companies/${r.id}`,
            );
          }
          else setError(r.reason);
        });
      }}
    >
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
        className="min-h-[48px] w-full rounded-[14px] bg-blue px-4 text-[14px] font-medium text-blue-foreground disabled:opacity-50"
      >
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
