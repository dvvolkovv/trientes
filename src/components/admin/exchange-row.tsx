"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { approveExchange, rejectExchange } from "@/app/actions/admin-exchange";
import type { ExchangeStatus } from "@prisma/client";

export type ExchangeRowData = {
  id: string;
  displayName: string;
  legalName: string;
  ownerUsername: string;
  country: string;
  website: string;
  email: string;
  logoUrl: string | null;
  status: ExchangeStatus;
  rejectionReason: string | null;
  createdAt: string;
};

export function ExchangeRow({ row }: { row: ExchangeRowData }) {
  const t = useTranslations("admin.exchanges");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onApprove = () => {
    setError(null);
    startTransition(async () => {
      const r = await approveExchange({ exchangeId: row.id });
      if (r.ok) router.refresh();
      else setError(r.reason ?? "generic");
    });
  };

  const onReject = () => {
    setError(null);
    if (reason.trim().length < 3) {
      setError("reason_too_short");
      return;
    }
    startTransition(async () => {
      const r = await rejectExchange({ exchangeId: row.id, rejectionReason: reason });
      if (r.ok) router.refresh();
      else setError(r.reason ?? "generic");
    });
  };

  return (
    <div className="bg-card border border-hairline rounded-[20px] p-4 md:p-6 space-y-3">
      <div className="flex items-start gap-4">
        {row.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.logoUrl} alt="" className="w-12 h-12 rounded-md object-cover bg-bg-tint" />
        ) : (
          <div className="w-12 h-12 rounded-md bg-bg-tint" />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[15px] truncate">{row.displayName}</div>
          <div className="text-xs text-muted truncate">
            {row.legalName} · {row.country} · @{row.ownerUsername}
          </div>
          <div className="text-xs text-muted truncate">{row.email}</div>
          <a
            href={row.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent break-all"
          >
            {row.website}
          </a>
        </div>
        {row.status === "PENDING" && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onApprove}
              disabled={pending}
              className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-green-500/15 text-green-500 disabled:opacity-50"
            >
              {t("approve")}
            </button>
            <button
              onClick={() => setShowReject((s) => !s)}
              disabled={pending}
              className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-red-500/15 text-red-500 disabled:opacity-50"
            >
              {t("reject")}
            </button>
          </div>
        )}
      </div>
      {showReject && row.status === "PENDING" && (
        <div className="space-y-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("rejectReasonPlaceholder")}
            className="w-full px-3 py-2 rounded-md border border-hairline bg-bg-tint text-sm"
          />
          <button
            onClick={onReject}
            disabled={pending}
            className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-red-500 text-white disabled:opacity-50"
          >
            {t("reject")}
          </button>
        </div>
      )}
      {row.status === "REJECTED" && row.rejectionReason && (
        <p className="text-xs text-red-400">{row.rejectionReason}</p>
      )}
      {error && <p className="text-xs text-red-500">{t(`errors.${error}`)}</p>}
    </div>
  );
}
