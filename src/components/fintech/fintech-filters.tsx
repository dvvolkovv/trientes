"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { FINTECH_SERVICES, FINTECH_KYC } from "@/lib/fintech";

export function FintechFilters() {
  const t = useTranslations("fintech");
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  function setParam(key: string, val: string | null) {
    const next = new URLSearchParams(sp.toString());
    if (val) next.set(key, val);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-3 mb-8">
      <select
        className="rounded-md border border-hairline bg-card px-3 py-1.5 text-sm"
        value={sp.get("service") ?? ""}
        onChange={(e) => setParam("service", e.target.value || null)}
      >
        <option value="">{t("filters.allServices")}</option>
        {FINTECH_SERVICES.map((s) => (
          <option key={s} value={s}>{t(`services.${s}`)}</option>
        ))}
      </select>

      <select
        className="rounded-md border border-hairline bg-card px-3 py-1.5 text-sm"
        value={sp.get("kyc") ?? ""}
        onChange={(e) => setParam("kyc", e.target.value || null)}
      >
        <option value="">{t("filters.allKyc")}</option>
        {FINTECH_KYC.map((k) => (
          <option key={k} value={k}>{t(`kyc.${k}`)}</option>
        ))}
      </select>

      <input
        className="rounded-md border border-hairline bg-card px-3 py-1.5 text-sm w-28"
        placeholder={t("filters.countryCode")}
        defaultValue={sp.get("country") ?? ""}
        maxLength={2}
        onBlur={(e) => setParam("country", e.target.value.toUpperCase() || null)}
      />

      <select
        className="rounded-md border border-hairline bg-card px-3 py-1.5 text-sm"
        value={sp.get("sort") ?? "name"}
        onChange={(e) => setParam("sort", e.target.value)}
      >
        <option value="name">{t("sort.name")}</option>
        <option value="featured">{t("sort.featured")}</option>
        <option value="newest">{t("sort.newest")}</option>
      </select>
    </div>
  );
}
