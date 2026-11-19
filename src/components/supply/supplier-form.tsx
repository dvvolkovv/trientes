"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { saveSupplier, setSupplierArchived } from "@/app/actions/supply";

export type PortalCandidate = { id: string; displayName: string };

export type SupplierView = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
  archivedAt: string | null;
  portalCompanyId: string | null;
  portalCompanyName: string | null;
  openOrders: number;
};

/**
 * Поставщики. Портал есть только у того, кто сам есть предприятие платформы — тогда
 * заказ открывается в его кабинете. У внешнего поставщика портала нет вовсе, и кнопки
 * мы не рисуем: обманка хуже отказа (правило BE).
 */
export function SupplierSection({
  companyId,
  rows,
  candidates,
  editable,
}: {
  companyId: string;
  rows: SupplierView[];
  candidates: PortalCandidate[];
  editable: boolean;
}) {
  const t = useTranslations("supply");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [portal, setPortal] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const field = "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm";
  const label = "text-[12px] uppercase tracking-[0.14em] text-muted";

  function reset() {
    setEditing(null);
    setName("");
    setPortal("");
    setContactName("");
    setEmail("");
    setPhone("");
    setError(null);
  }

  return (
    <section className="mb-10">
      <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("suppliersHeading")}</h2>

      {rows.length === 0 ? (
        <p className="text-sm text-muted mb-3">{t("suppliersEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2 mb-3">
          {rows.map((s) => (
            <li key={s.id} className="border border-hairline rounded-lg p-3">
              <div className="text-sm font-medium">
                {s.name}
                {s.archivedAt ? <span className="text-muted"> · {t("archived")}</span> : null}
              </div>
              <div className="text-[11px] text-muted">
                {s.portalCompanyId ? t("hasPortal", { company: s.portalCompanyName ?? "" }) : t("noPortal")}
                {s.contactName ? ` · ${s.contactName}` : ""}
                {s.email ? ` · ${s.email}` : ""}
                {s.phone ? ` · ${s.phone}` : ""}
              </div>
              {s.openOrders > 0 ? (
                <div className="text-[11px] text-muted num">{t("openOrders", { count: s.openOrders })}</div>
              ) : null}
              {editable ? (
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(true);
                      setEditing(s.id);
                      setName(s.name);
                      setPortal(s.portalCompanyId ?? "");
                      setContactName(s.contactName ?? "");
                      setEmail(s.email ?? "");
                      setPhone(s.phone ?? "");
                    }}
                    className="h-12 px-4 rounded-md border border-hairline text-sm"
                  >
                    {t("edit")}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setError(null);
                      start(async () => {
                        const r = await setSupplierArchived(companyId, s.id, !s.archivedAt);
                        if (r.ok) router.refresh();
                        else setError(r.reason);
                      });
                    }}
                    className="h-12 px-4 rounded-md border border-hairline text-sm disabled:opacity-50"
                  >
                    {s.archivedAt ? t("restore") : t("archive")}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        open ? (
          <div className="border border-hairline rounded-lg p-4 space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className={label}>{t("supplierName")}</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
              </label>
              <label className="block space-y-1">
                <span className={label}>{t("portalCompany")}</span>
                <select value={portal} onChange={(e) => setPortal(e.target.value)} className={field}>
                  <option value="">{t("portalNone")}</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className={label}>{t("contactName")}</span>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={field} />
              </label>
              <label className="block space-y-1">
                <span className={label}>{t("email")}</span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
              </label>
              <label className="block space-y-1">
                <span className={label}>{t("phone")}</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={field} />
              </label>
            </div>
            <p className="text-[11px] text-muted">{t("portalHint")}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const r = await saveSupplier(companyId, editing, {
                      name,
                      supplierCompanyId: portal || null,
                      contactName: contactName || null,
                      email: email || null,
                      phone: phone || null,
                      note: null,
                    });
                    if (r.ok) {
                      reset();
                      setOpen(false);
                      router.refresh();
                    } else {
                      setError(r.reason);
                    }
                  });
                }}
                className="h-12 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
              >
                {t("save")}
              </button>
              <button
                type="button"
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
                className="h-12 px-4 rounded-md border border-hairline text-sm"
              >
                {t("cancel")}
              </button>
            </div>
            {error ? <p className="text-[13px] text-red-500">{t(`error.${error}`)}</p> : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="h-12 px-4 rounded-md border border-hairline text-sm"
          >
            {t("addSupplier")}
          </button>
        )
      ) : null}
      {!open && error ? <p className="text-[13px] text-red-500 mt-2">{t(`error.${error}`)}</p> : null}
    </section>
  );
}
