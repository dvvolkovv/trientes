"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { approveRequest, rejectRequest } from "@/app/actions/admin-requests";

export type RequestRowData = {
  id: string;
  createdAt: string;
  name: string;
  symbol: string;
  coingeckoId: string | null;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectReason: string | null;
  userEmail: string | null;
};

export function RequestRow({ row }: { row: RequestRowData }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [overrideId, setOverrideId] = useState(row.coingeckoId ?? "");
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectMsg, setRejectMsg] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isPending = row.status === "PENDING";

  const statusBadgeClasses =
    row.status === "PENDING"
      ? "bg-accent/20 text-accent"
      : row.status === "APPROVED"
        ? "bg-up/15 text-up"
        : "bg-down/15 text-down";

  return (
    <div className="bg-card border border-hairline rounded-[20px] p-5 md:p-6 space-y-3">
      <div className="flex items-center gap-3">
        <span className="font-medium text-[15px]">{row.name}</span>
        <span className="num text-[11px] uppercase tracking-wider text-muted">
          {row.symbol}
        </span>
        <span
          className={`ml-auto num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium ${statusBadgeClasses}`}
        >
          {t(`status.${row.status}`)}
        </span>
      </div>
      <p className="text-sm text-muted-strong">{row.reason}</p>
      <p className="num text-[11px] text-muted">
        {row.userEmail ?? "(no email)"} · {row.createdAt.slice(0, 10)}
      </p>

      {isPending && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={overrideId}
              onChange={(e) => setOverrideId(e.target.value)}
              placeholder="coingecko-id"
              className="flex-1 bg-bg-tint border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setError(null);
                start(async () => {
                  const res = await approveRequest({
                    requestId: row.id,
                    coingeckoIdOverride: overrideId,
                  });
                  if (res.ok) router.refresh();
                  else setError(res.reason ?? "unknown_error");
                });
              }}
              className="bg-accent text-accent-foreground rounded-md px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:brightness-110 disabled:opacity-50"
            >
              {t("approve")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setRejectMode(!rejectMode)}
              className="border border-hairline text-foreground hover:bg-card-alt rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {t("reject")}
            </button>
          </div>
          {rejectMode && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={rejectMsg}
                onChange={(e) => setRejectMsg(e.target.value)}
                placeholder={t("rejectReasonPlaceholder")}
                className="flex-1 bg-bg-tint border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none"
              />
              <button
                type="button"
                disabled={pending || rejectMsg.trim().length < 3}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const res = await rejectRequest({
                      requestId: row.id,
                      rejectReason: rejectMsg,
                    });
                    if (res.ok) router.refresh();
                    else setError(res.reason ?? "unknown_error");
                  });
                }}
                className="bg-down/20 text-down border border-down/40 rounded-md px-4 py-2 text-sm font-medium hover:bg-down/30 disabled:opacity-50"
              >
                {t("confirmReject")}
              </button>
            </div>
          )}
          {error && <p className="text-down text-sm">{t(`errors.${error}`)}</p>}
        </>
      )}

      {row.status === "REJECTED" && row.rejectReason && (
        <p className="text-down text-sm">
          {t("rejectReasonLabel")}: {row.rejectReason}
        </p>
      )}
    </div>
  );
}
