"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { saveCompanyProfile } from "@/app/actions/company";
import { COUNTRIES } from "@/lib/countries";

type Initial = {
  legalName: string; displayName: string; description: string;
  website: string; logoUrl: string;
  country: string; countryCode: string;
  city: string; street: string; houseNumber: string; postalCode: string;
  address: string; phone: string; email: string;
};

const EMPTY: Initial = {
  legalName: "", displayName: "", description: "", website: "", logoUrl: "",
  country: "", countryCode: "", city: "", street: "", houseNumber: "",
  postalCode: "", address: "", phone: "", email: "",
};

export function CompanyProfileForm({ companyId, initial }: { companyId: string; initial?: Partial<Initial> }) {
  const t = useTranslations("business");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState<Initial>({ ...EMPTY, ...initial });
  const set = <K extends keyof Initial>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setF({ ...f, [k]: e.target.value });

  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveCompanyProfile(companyId, {
        ...f,
        // Country name auto-derived from selected code if user only picked from list.
        country: f.country || (COUNTRIES.find((c) => c.code === f.countryCode)?.name ?? ""),
      });
      if (res.ok) { setMsg(t("profileSaved")); router.refresh(); }
      else setMsg(t(`err.${res.reason}`) ?? t("err.generic"));
    });
  }

  const input = "w-full bg-bg-tint border border-hairline rounded-md px-3 py-2 text-[13px]";
  return (
    <div className="space-y-3">
      <input className={input} value={f.legalName} onChange={set("legalName")} placeholder={t("legalName")} />
      <input className={input} value={f.displayName} onChange={set("displayName")} placeholder={t("displayName")} />
      <textarea className={input} value={f.description} onChange={set("description")} placeholder={t("description")} rows={4} />
      <input className={input} value={f.logoUrl} onChange={set("logoUrl")} placeholder={t("logoUrl")} />
      <div>
        <input className={input} value={f.website} onChange={set("website")} placeholder={t("website")} />
        <p className="text-[11px] text-muted mt-1">{t("websiteHint")}</p>
      </div>
      <input className={input} value={f.phone} onChange={set("phone")} placeholder={t("phone")} />
      <input className={input} value={f.email} onChange={set("email")} placeholder={t("email")} />

      <div className="pt-2 text-[12px] uppercase tracking-wide text-muted">{t("addressSection")}</div>
      <select className={input} value={f.countryCode} onChange={set("countryCode")}>
        <option value="">{t("country")}</option>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-3">
        <input className={input} value={f.city} onChange={set("city")} placeholder={t("city")} />
        <input className={input} value={f.postalCode} onChange={set("postalCode")} placeholder={t("postalCode")} />
      </div>
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <input className={input} value={f.street} onChange={set("street")} placeholder={t("street")} />
        <input className={input} value={f.houseNumber} onChange={set("houseNumber")} placeholder={t("houseNumber")} />
      </div>

      <button type="button" disabled={pending || !f.legalName.trim() || !f.displayName.trim()} onClick={save}
        className="text-[13px] px-4 py-2 rounded-md font-medium bg-accent text-accent-foreground disabled:opacity-50">
        {t("saveProfile")}
      </button>
      {msg && <p className="text-[13px] text-accent">{msg}</p>}
    </div>
  );
}
