"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-medium">{row.name}</span>
        <span className="text-xs text-muted-foreground uppercase">{row.symbol}</span>
        <span
          className={`ml-auto px-2 py-0.5 text-xs rounded ${
            row.status === "PENDING"
              ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
              : row.status === "APPROVED"
                ? "bg-green-500/15 text-green-700 dark:text-green-400"
                : "bg-red-500/15 text-red-700 dark:text-red-400"
          }`}
        >
          {t(`status.${row.status}`)}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{row.reason}</p>
      <p className="text-xs text-muted-foreground">
        {row.userEmail ?? "(no email)"} · {row.createdAt.slice(0, 10)}
      </p>

      {isPending && (
        <>
          <div className="flex items-center gap-2">
            <Input
              value={overrideId}
              onChange={(e) => setOverrideId(e.target.value)}
              placeholder="coingecko-id"
              className="text-sm"
            />
            <Button
              size="sm"
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
            >
              {t("approve")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setRejectMode(!rejectMode)}
            >
              {t("reject")}
            </Button>
          </div>
          {rejectMode && (
            <div className="flex items-center gap-2">
              <Input
                value={rejectMsg}
                onChange={(e) => setRejectMsg(e.target.value)}
                placeholder={t("rejectReasonPlaceholder")}
                className="text-sm"
              />
              <Button
                size="sm"
                variant="destructive"
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
              >
                {t("confirmReject")}
              </Button>
            </div>
          )}
          {error && <p className="text-sm text-red-500">{t(`errors.${error}`)}</p>}
        </>
      )}

      {row.status === "REJECTED" && row.rejectReason && (
        <p className="text-sm text-red-500">
          {t("rejectReasonLabel")}: {row.rejectReason}
        </p>
      )}
    </div>
  );
}
