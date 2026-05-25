"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { saveCompanyProfile } from "@/app/actions/company";

type Initial = { legalName: string; displayName: string; description: string; website: string; logoUrl: string; address: string; phone: string; email: string; country: string };

export function CompanyProfileForm({ companyId, initial }: { companyId: string; initial?: Partial<Initial> }) {
  const t = useTranslations("business");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState<Initial>({
    legalName: initial?.legalName ?? "", displayName: initial?.displayName ?? "", description: initial?.description ?? "",
    website: initial?.website ?? "", logoUrl: initial?.logoUrl ?? "", address: initial?.address ?? "",
    phone: initial?.phone ?? "", email: initial?.email ?? "", country: initial?.country ?? "",
  });
  const set = (k: keyof Initial) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveCompanyProfile(companyId, f);
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
      <input className={input} value={f.website} onChange={set("website")} placeholder={t("website")} />
      <input className={input} value={f.address} onChange={set("address")} placeholder={t("address")} />
      <input className={input} value={f.phone} onChange={set("phone")} placeholder={t("phone")} />
      <input className={input} value={f.email} onChange={set("email")} placeholder={t("email")} />
      <input className={input} value={f.country} onChange={set("country")} placeholder={t("country")} />
      <button type="button" disabled={pending || !f.legalName.trim() || !f.displayName.trim()} onClick={save}
        className="text-[13px] px-4 py-2 rounded-md font-medium bg-accent text-accent-foreground disabled:opacity-50">
        {t("saveProfile")}
      </button>
      {msg && <p className="text-[13px] text-accent">{msg}</p>}
    </div>
  );
}
