"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { KybStatus, Prisma } from "@prisma/client";
import { approveKyb, rejectKyb } from "@/app/actions/kyb";

type Doc = { kind?: string; url?: string; label?: string | null };

export function KybRow({
  companyId,
  displayName,
  legalName,
  ownerHandle,
  status,
  documents,
  submittedAt,
  rejectionReason,
}: {
  companyId: string;
  displayName: string;
  legalName: string;
  ownerHandle: string;
  status: KybStatus;
  documents: Prisma.JsonValue;
  submittedAt: string | null;
  rejectionReason: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const docs: Doc[] = Array.isArray(documents) ? (documents as Doc[]) : [];

  function approve() {
    start(async () => {
      setError(null);
      const r = await approveKyb({ companyId });
      if (r.ok) router.refresh();
      else setError(r.reason ?? "unknown");
    });
  }
  function reject() {
    if (reason.trim().length < 3) {
      setError("reason_too_short");
      return;
    }
    start(async () => {
      setError(null);
      const r = await rejectKyb({ companyId, reason });
      if (r.ok) router.refresh();
      else setError(r.reason ?? "unknown");
    });
  }

  return (
    <div className="bg-card border border-hairline rounded-[16px] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-medium">{displayName}</div>
          <div className="text-[13px] text-muted">{legalName}</div>
          <div className="text-[11px] text-muted">owner: {ownerHandle}</div>
          {submittedAt ? (
            <div className="text-[11px] text-muted">submitted: {new Date(submittedAt).toLocaleString()}</div>
          ) : null}
          {rejectionReason ? (
            <div className="text-[12px] text-red-400 mt-1">{rejectionReason}</div>
          ) : null}
          <ul className="mt-2 space-y-1 text-[12px]">
            {docs.map((d, i) => (
              <li key={i}>
                <span className="text-muted uppercase tracking-wider mr-2">{d.kind ?? "OTHER"}</span>
                <a href={d.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline">
                  {d.label?.trim() || d.url || "—"}
                </a>
              </li>
            ))}
          </ul>
        </div>
        {status === "PENDING" ? (
          <div className="flex flex-col gap-2 shrink-0">
            <button
              type="button"
              onClick={approve}
              disabled={pending}
              className="text-[12px] px-3 py-1.5 rounded-md bg-up/15 text-up font-medium disabled:opacity-50"
            >
              Approve KYB
            </button>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="reject reason"
              className="text-[12px] bg-bg-tint border border-hairline rounded-md px-2 py-1"
            />
            <button
              type="button"
              onClick={reject}
              disabled={pending}
              className="text-[12px] px-3 py-1.5 rounded-md bg-down/15 text-down font-medium disabled:opacity-50"
            >
              Reject
            </button>
            {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
          </div>
        ) : (
          <span className="text-xs text-muted shrink-0">{status}</span>
        )}
      </div>
    </div>
  );
}
