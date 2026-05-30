"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FINTECH_SERVICES, FINTECH_KYC } from "@/lib/fintech";

type FormValue = {
  slug: string;
  displayName: string;
  legalName: string;
  logoUrl: string;
  website: string;
  description: string;
  countryCode: string;
  city: string;
  address: string;
  hqLat: string;
  hqLon: string;
  services: string[];
  availableIn: string;
  supportedCoinIds: string;
  supportedFiats: string;
  kycLevel: string;
  feesSummary: string;
  appStoreUrl: string;
  playStoreUrl: string;
  foundedYear: string;
};

export type FintechFormProps = {
  initial?: Partial<FormValue>;
  // null result means success; string is a reason key to render.
  submit: (payload: unknown) => Promise<{ ok: true; id?: string } | { ok: false; reason: string; details?: unknown }>;
  redirectTo?: string;
};

const EMPTY: FormValue = {
  slug: "", displayName: "", legalName: "", logoUrl: "", website: "", description: "",
  countryCode: "", city: "", address: "", hqLat: "", hqLon: "",
  services: [], availableIn: "", supportedCoinIds: "", supportedFiats: "",
  kycLevel: "", feesSummary: "", appStoreUrl: "", playStoreUrl: "", foundedYear: "",
};

export function FintechForm({ initial, submit, redirectTo }: FintechFormProps) {
  const t = useTranslations("fintech");
  const router = useRouter();
  const [v, setV] = useState<FormValue>({ ...EMPTY, ...initial } as FormValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function set<K extends keyof FormValue>(k: K, val: FormValue[K]) {
    setV((s) => ({ ...s, [k]: val }));
  }

  function toggleService(s: string) {
    setV((cur) => ({
      ...cur,
      services: cur.services.includes(s) ? cur.services.filter((x) => x !== s) : [...cur.services, s],
    }));
  }

  function splitCsv(s: string, upper = false): string[] {
    return s.split(",").map((x) => x.trim()).filter(Boolean).map((x) => (upper ? x.toUpperCase() : x.toLowerCase()));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    const payload = {
      slug: v.slug.trim(),
      displayName: v.displayName.trim(),
      legalName: v.legalName.trim() || null,
      logoUrl: v.logoUrl.trim() || null,
      description: v.description.trim() || null,
      website: v.website.trim(),
      foundedYear: v.foundedYear ? Number(v.foundedYear) : null,
      countryCode: v.countryCode.trim().toUpperCase() || null,
      city: v.city.trim() || null,
      address: v.address.trim() || null,
      hqLat: v.hqLat ? Number(v.hqLat) : null,
      hqLon: v.hqLon ? Number(v.hqLon) : null,
      services: v.services,
      supportedCoinIds: splitCsv(v.supportedCoinIds),
      supportedFiats: splitCsv(v.supportedFiats, true),
      availableIn: splitCsv(v.availableIn, true),
      kycLevel: v.kycLevel || null,
      feesSummary: v.feesSummary.trim() || null,
      appStoreUrl: v.appStoreUrl.trim() || null,
      playStoreUrl: v.playStoreUrl.trim() || null,
    };
    try {
      const res = await submit(payload);
      if (res.ok) {
        setOk(t("form.submitted"));
        if (redirectTo) router.push(redirectTo);
        router.refresh();
      } else {
        setError(t(`form.errors.${res.reason}`, { default: res.reason }));
      }
    } catch (e) {
      setError(t("form.errors.unknown") + (e instanceof Error ? `: ${e.message}` : ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label={t("form.slug")} hint={t("form.slugHint")}>
          <input className={input} value={v.slug} onChange={(e) => set("slug", e.target.value)} required />
        </Field>
        <Field label={t("form.displayName")}>
          <input className={input} value={v.displayName} onChange={(e) => set("displayName", e.target.value)} required />
        </Field>
        <Field label={t("form.website")}>
          <input className={input} type="url" value={v.website} onChange={(e) => set("website", e.target.value)} required />
        </Field>
        <Field label={t("form.legalName")}>
          <input className={input} value={v.legalName} onChange={(e) => set("legalName", e.target.value)} />
        </Field>
        <Field label={t("form.logoUrl")}>
          <input className={input} type="url" value={v.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} />
        </Field>
        <Field label={t("form.foundedYear")}>
          <input className={input} type="number" min={1900} max={2100} value={v.foundedYear} onChange={(e) => set("foundedYear", e.target.value)} />
        </Field>
      </div>

      <Field label={t("form.description")}>
        <textarea className={input + " min-h-[100px]"} value={v.description} onChange={(e) => set("description", e.target.value)} />
      </Field>

      <Fieldset label={t("form.services")}>
        <div className="flex flex-wrap gap-2">
          {FINTECH_SERVICES.map((s) => {
            const on = v.services.includes(s);
            return (
              <button key={s} type="button" onClick={() => toggleService(s)}
                className={
                  on
                    ? "rounded-md bg-accent text-bg px-3 py-1.5 text-sm"
                    : "rounded-md border border-hairline bg-card px-3 py-1.5 text-sm hover:border-accent/40"
                }>
                {t(`services.${s}`)}
              </button>
            );
          })}
        </div>
      </Fieldset>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label={t("form.availableIn")} hint={t("form.csvHint")}>
          <input className={input} value={v.availableIn} onChange={(e) => set("availableIn", e.target.value)} placeholder="GB, US, DE" />
        </Field>
        <Field label={t("form.supportedFiats")} hint={t("form.csvHint")}>
          <input className={input} value={v.supportedFiats} onChange={(e) => set("supportedFiats", e.target.value)} placeholder="USD, EUR" />
        </Field>
        <Field label={t("form.supportedCoins")} hint={t("form.csvHint")}>
          <input className={input} value={v.supportedCoinIds} onChange={(e) => set("supportedCoinIds", e.target.value)} placeholder="bitcoin, ethereum" />
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label={t("form.kycLevel")}>
          <select className={input} value={v.kycLevel} onChange={(e) => set("kycLevel", e.target.value)}>
            <option value="">—</option>
            {FINTECH_KYC.map((k) => <option key={k} value={k}>{t(`kyc.${k}`)}</option>)}
          </select>
        </Field>
        <Field label={t("form.countryCode")}>
          <input className={input} maxLength={2} value={v.countryCode} onChange={(e) => set("countryCode", e.target.value.toUpperCase())} />
        </Field>
        <Field label={t("form.city")}>
          <input className={input} value={v.city} onChange={(e) => set("city", e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label={t("form.address")}>
          <input className={input} value={v.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label={t("form.hqLat")}>
          <input className={input} type="number" step="any" value={v.hqLat} onChange={(e) => set("hqLat", e.target.value)} />
        </Field>
        <Field label={t("form.hqLon")}>
          <input className={input} type="number" step="any" value={v.hqLon} onChange={(e) => set("hqLon", e.target.value)} />
        </Field>
      </div>

      <Field label={t("form.feesSummary")}>
        <textarea className={input + " min-h-[80px]"} value={v.feesSummary} onChange={(e) => set("feesSummary", e.target.value)} />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label={t("form.appStoreUrl")}>
          <input className={input} type="url" value={v.appStoreUrl} onChange={(e) => set("appStoreUrl", e.target.value)} />
        </Field>
        <Field label={t("form.playStoreUrl")}>
          <input className={input} type="url" value={v.playStoreUrl} onChange={(e) => set("playStoreUrl", e.target.value)} />
        </Field>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {ok ? <p className="text-sm text-up">{ok}</p> : null}

      <button type="submit" disabled={busy}
        className="rounded-md bg-accent text-bg px-4 py-2 text-sm font-semibold disabled:opacity-50">
        {busy ? t("form.submitting") : t("form.submit")}
      </button>
    </form>
  );
}

const input = "w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm focus:outline-none focus:border-accent/60";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="num text-[11px] uppercase tracking-[0.2em] text-muted block mb-1.5">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-muted/70 mt-1 block">{hint}</span> : null}
    </label>
  );
}

function Fieldset({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="num text-[11px] uppercase tracking-[0.2em] text-muted block mb-2">{label}</div>
      {children}
    </div>
  );
}
