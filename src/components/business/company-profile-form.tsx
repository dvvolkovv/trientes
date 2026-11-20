"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { saveCompanyProfile } from "@/app/actions/company";
import { COUNTRIES } from "@/lib/countries";
import { ADMIN_BUTTON, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";
import { MERCHANT_CATEGORIES } from "@/lib/merchant-categories";

type Initial = {
  legalName: string; displayName: string; description: string;
  website: string; logoUrl: string;
  country: string; countryCode: string;
  city: string; street: string; houseNumber: string; postalCode: string;
  address: string; phone: string; email: string;
  /** Слайс BN: вид заведения и политика возврата — свободные поля. */
  category: string; returnPolicy: string; returnDays: string;
};

const EMPTY: Initial = {
  legalName: "", displayName: "", description: "", website: "", logoUrl: "",
  country: "", countryCode: "", city: "", street: "", houseNumber: "",
  postalCode: "", address: "", phone: "", email: "",
  category: "", returnPolicy: "", returnDays: "",
};

type Doc = { kind: string; url: string; label: string | null };

const DOC_KINDS = ["REGISTRATION_CERT", "TAX_CERT", "ID", "OTHER"] as const;

export function CompanyProfileForm({
  companyId,
  initial,
  /** Залистованное предприятие: модерируемые поля уходят правкой, а не в карточку. */
  moderated,
  backHref,
}: {
  companyId: string;
  initial?: Partial<Initial>;
  moderated: boolean;
  backHref?: string;
}) {
  const t = useTranslations("business");
  const tk = useTranslations("business.kyb");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<Initial>({ ...EMPTY, ...initial });
  const [docs, setDocs] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof Initial>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setF({ ...f, [k]: e.target.value });

  // Юридическое имя подтверждается бумагой. Блок загрузки показывается ровно тогда,
  // когда имя действительно поменяли: форма с полем, которое ни на что не влияет,
  // хуже, чем её отсутствие.
  const legalNameChanged =
    moderated && f.legalName.trim() !== (initial?.legalName ?? "").trim();

  async function upload(file: File) {
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("companyId", companyId);
      fd.append("file", file);
      const res = await fetch("/api/business/kyb/upload", { method: "POST", body: fd });
      const j = (await res.json()) as { url?: string; filename?: string; error?: string };
      if (res.ok && j.url) {
        setDocs((arr) => [...arr, { kind: "REGISTRATION_CERT", url: j.url!, label: j.filename ?? null }]);
      } else setErr(t(`err.${j.error ?? "generic"}`));
    } catch {
      setErr(t("err.generic"));
    } finally {
      setUploading(false);
    }
  }

  function save() {
    setMsg(null);
    setErr(null);
    start(async () => {
      const res = await saveCompanyProfile(
        companyId,
        {
          ...f,
          // Country name auto-derived from selected code if user only picked from list.
          country: f.country || (COUNTRIES.find((c) => c.code === f.countryCode)?.name ?? ""),
        },
        docs,
      );
      if (res.ok) {
        setMsg(res.moderated && res.moderated > 0 ? t("profileSentToReview", { count: res.moderated }) : t("profileSaved"));
        router.refresh();
      } else setErr(t(`err.${res.reason}`));
    });
  }

  const input = "w-full bg-bg-tint border border-hairline rounded-md px-3 py-2 text-[13px]";
  const label = "block text-[11px] uppercase tracking-wider text-muted mb-1";
  const field = (k: keyof Initial, extra?: React.ReactNode) => (
    <div>
      <label className={label} htmlFor={`company-${k}`}>
        {t(k as string)}
      </label>
      <input id={`company-${k}`} className={input} value={f[k]} onChange={set(k)} />
      {extra}
    </div>
  );

  return (
    <div className="space-y-4">
      {moderated ? (
        <p className="rounded-md border border-hairline bg-card-alt p-3 text-[12px] text-muted">
          {t("moderatedEditHint")}
        </p>
      ) : null}

      <div className="space-y-3">
        {field("legalName")}
        {field("displayName")}
        <div>
          <label className={label} htmlFor="company-description">{t("description")}</label>
          <textarea id="company-description" className={input} value={f.description} onChange={set("description")} rows={4} />
        </div>
        {field("logoUrl")}
        {field("website", <p className="mt-1 text-[11px] text-muted">{t("websiteHint")}</p>)}
        {field("phone")}
        {field("email")}
      </div>

      {/* Вид заведения и политика возврата (слайс BN). Оба поля свободные: вид не
          меняет ни места, ни монет, ни хозяина, а политика возврата — собственное
          обещание продавца покупателю, и чем раньше оно на витрине, тем лучше. */}
      <div className="space-y-3">
        <div className="pt-1 text-[12px] uppercase tracking-wide text-muted">{t("categorySection")}</div>
        <div className="flex flex-wrap gap-1.5">
          {MERCHANT_CATEGORIES.map((c) => {
            const on = f.category === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setF({ ...f, category: on ? "" : c.key })}
                aria-pressed={on}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-[12px] border px-2.5 text-[12px] ${
                  on ? "border-accent bg-accent/10 text-accent" : "border-hairline bg-bg-tint text-muted hover:border-accent/50"
                }`}
              >
                <span aria-hidden>{c.emoji}</span>
                {t(`category.${c.key}`)}
              </button>
            );
          })}
        </div>
        <div>
          <label className={label} htmlFor="company-returnDays">{t("returnDays")}</label>
          <input
            id="company-returnDays"
            className={input}
            inputMode="numeric"
            value={f.returnDays}
            onChange={set("returnDays")}
            placeholder="14"
          />
        </div>
        <div>
          <label className={label} htmlFor="company-returnPolicy">{t("returnPolicy")}</label>
          <textarea
            id="company-returnPolicy"
            className={input}
            value={f.returnPolicy}
            onChange={set("returnPolicy")}
            rows={4}
          />
          <p className="mt-1 text-[11px] text-muted">{t("returnPolicyHint")}</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="pt-1 text-[12px] uppercase tracking-wide text-muted">{t("addressSection")}</div>
        <div>
          <label className={label} htmlFor="company-country">{t("country")}</label>
          <select id="company-country" className={input} value={f.countryCode} onChange={set("countryCode")}>
            <option value="">{t("country")}</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field("city")}
          {field("postalCode")}
        </div>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          {field("street")}
          {field("houseNumber")}
        </div>
      </div>

      {legalNameChanged ? (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3">
          <div className="mb-1 text-[11px] uppercase tracking-wider text-yellow-500">
            {t("documentsRequiredTitle")}
          </div>
          <p className="mb-2 text-[12px] text-muted">{t("documentsRequiredHint")}</p>
          {docs.length > 0 ? (
            <ul className="mb-2 space-y-1 text-[12px]">
              {docs.map((d, i) => (
                <li key={d.url} className="flex items-center gap-2">
                  <select
                    className="rounded border border-hairline bg-bg-tint px-1.5 py-1 text-[11px]"
                    value={d.kind}
                    onChange={(e) =>
                      setDocs((arr) => arr.map((x, idx) => (idx === i ? { ...x, kind: e.target.value } : x)))
                    }
                  >
                    {DOC_KINDS.map((k) => (
                      <option key={k} value={k}>{tk(`kind.${k}`)}</option>
                    ))}
                  </select>
                  <span className="min-w-0 flex-1 truncate">{d.label ?? d.url}</span>
                  <button
                    type="button"
                    onClick={() => setDocs((arr) => arr.filter((_, idx) => idx !== i))}
                    className="text-[11px] text-muted underline"
                  >
                    {t("remove")}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            disabled={uploading || docs.length >= 8}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
            className="text-[12px]"
          />
        </div>
      ) : null}

      <div className="space-y-2">
        <button
          type="button"
          disabled={pending || uploading || !f.legalName.trim() || !f.displayName.trim()}
          onClick={save}
          className={ADMIN_BUTTON}
        >
          {moderated ? t("sendForReview") : t("saveProfile")}
        </button>
        {backHref ? (
          <a href={backHref} className={ADMIN_BUTTON_SECONDARY}>
            {t("cancelEdit")}
          </a>
        ) : null}
      </div>
      {msg && <p className="text-[13px] text-accent">{msg}</p>}
      {err && <p className="text-[13px] text-red-400">{err}</p>}
    </div>
  );
}
