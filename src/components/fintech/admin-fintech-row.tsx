"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { approveFintech, rejectFintech, deleteFintech } from "@/app/actions/admin-fintech";

export type AdminFintechRowData = {
  id: string;
  slug: string;
  displayName: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  source: string;
  services: string[];
  availableIn: string[];
  rejectionReason: string | null;
  createdAt: string;
  ownerEmail: string | null;
};

export function AdminFintechRow({ row }: { row: AdminFintechRowData }) {
  const t = useTranslations("fintech");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  async function approve() {
    setBusy(true);
    await approveFintech({ id: row.id });
    setBusy(false);
    router.refresh();
  }
  async function reject() {
    setBusy(true);
    const r = await rejectFintech({ id: row.id, rejectionReason: reason });
    setBusy(false);
    if (r.ok) {
      setShowReject(false);
      setReason("");
      router.refresh();
    }
  }
  async function del() {
    if (!confirm(t("admin.confirmDelete"))) return;
    setBusy(true);
    await deleteFintech({ id: row.id });
    setBusy(false);
    router.refresh();
  }

  const statusColor =
    row.status === "APPROVED" ? "text-up" :
    row.status === "REJECTED" ? "text-red-400" : "text-amber-400";

  return (
    <div className="bg-card border border-hairline rounded-2xl p-5">
      <div className="flex flex-wrap items-baseline gap-3 mb-3">
        <h3 className="text-base font-semibold">{row.displayName}</h3>
        <span className="num text-[11px] uppercase tracking-wider text-muted">{row.slug}</span>
        <span className={`num text-[11px] uppercase tracking-wider ${statusColor}`}>{row.status}</span>
        <span className="num text-[11px] uppercase tracking-wider text-muted">{row.source}</span>
        <span className="ml-auto text-[11px] text-muted">{row.createdAt.split("T")[0]}</span>
      </div>
      <div className="flex flex-wrap gap-1 mb-3">
        {row.services.map((s) => (
          <span key={s} className="rounded bg-bg/60 px-1.5 py-0.5 text-[10px] text-muted">{s}</span>
        ))}
      </div>
      <p className="text-[12px] text-muted mb-2">
        {t("admin.availableIn")}: {row.availableIn.length ? row.availableIn.join(", ") : "—"}
      </p>
      {row.ownerEmail ? <p className="text-[11px] text-muted">{t("admin.owner")}: {row.ownerEmail}</p> : null}
      {row.rejectionReason ? <p className="text-[12px] text-red-400 mt-2">— {row.rejectionReason}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {row.status !== "APPROVED" ? (
          <button onClick={approve} disabled={busy}
            className="rounded-md bg-up text-bg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
            {t("admin.approve")}
          </button>
        ) : null}
        {row.status !== "REJECTED" ? (
          <button onClick={() => setShowReject((s) => !s)} disabled={busy}
            className="rounded-md border border-red-400/40 text-red-400 px-3 py-1.5 text-xs">
            {t("admin.reject")}
          </button>
        ) : null}
        <button onClick={del} disabled={busy}
          className="rounded-md border border-hairline text-muted px-3 py-1.5 text-xs hover:text-red-400">
          {t("admin.delete")}
        </button>
      </div>

      {showReject ? (
        <div className="mt-3 flex gap-2">
          <input type="text" placeholder={t("admin.rejectReason")} value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="flex-1 rounded-md border border-hairline bg-bg px-3 py-1.5 text-sm" />
          <button onClick={reject} disabled={busy || reason.trim().length < 3}
            className="rounded-md bg-red-400/20 border border-red-400/40 text-red-300 px-3 py-1.5 text-xs disabled:opacity-50">
            {t("admin.confirm")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
