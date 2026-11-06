"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { DiffEntry } from "@/lib/coin-card-diff";
import { DiffView } from "@/components/coin-card-manage/diff-view";
import {
  applyCoinRevision,
  rejectCoinRevision,
  forceCoinRevision,
} from "@/app/actions/admin-coin-revisions";

export type AdminRevision = {
  id: string;
  kind: "CONTENT" | "POLICY";
  section: string | null;
  status: string;
  highRisk: boolean;
  diff: DiffEntry[];
  thresholdAt: number | null;
  signerCountAt: number | null;
  approvals: number;
  createdAt: string;
  cardName: string;
  cardSlug: string;
  authorLabel: string;
};

export function CoinRevisionRow({ revision }: { revision: AdminRevision }) {
  const t = useTranslations("admin.coinRevisions");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; reason?: string }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.ok) router.refresh();
      else setError(r.reason ?? "unknown");
    });
  }

  return (
    <div className="border border-hairline rounded-lg p-4 bg-card">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="font-semibold">{revision.cardName}</span>
        <span className="num text-[11px] uppercase tracking-[0.12em] text-muted">
          {revision.kind === "POLICY" ? t("policyChange") : revision.section}
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded bg-bg-tint">
          {t(`status.${revision.status}`)}
        </span>
        {revision.highRisk ? (
          <span className="text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border border-red-500/40 text-red-400">
            {t("highRisk")}
          </span>
        ) : null}
        <span className="text-[11px] text-muted">{t("author", { author: revision.authorLabel })}</span>
        {revision.thresholdAt ? (
          <span className="text-[11px] text-muted">
            {t("signatures", {
              approvals: revision.approvals,
              threshold: revision.thresholdAt,
              signers: revision.signerCountAt ?? 0,
            })}
          </span>
        ) : null}
        <span className="text-[11px] text-muted ml-auto">
          {revision.createdAt.slice(0, 16).replace("T", " ")}
        </span>
      </div>

      <DiffView diff={revision.diff} />

      <div className="flex flex-wrap gap-2 mt-3 items-center">
        {revision.status === "PENDING_ADMIN" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => applyCoinRevision(revision.id))}
            className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-medium disabled:opacity-50"
          >
            {t("apply")}
          </button>
        ) : null}
        {revision.status === "PENDING_SIGNERS" || revision.status === "EXPIRED" ? (
          <button
            type="button"
            disabled={pending || reason.trim().length < 3}
            onClick={() => run(() => forceCoinRevision(revision.id, reason))}
            className="px-3 py-1.5 rounded-md border border-hairline text-xs font-medium disabled:opacity-50"
          >
            {t("force")}
          </button>
        ) : null}
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("reasonPlaceholder")}
          className="flex-1 min-w-[180px] px-3 py-1.5 rounded-md border border-hairline bg-bg-tint text-xs"
        />
        {revision.status === "PENDING_ADMIN" ? (
          <button
            type="button"
            disabled={pending || reason.trim().length < 3}
            onClick={() => run(() => rejectCoinRevision(revision.id, reason))}
            className="px-3 py-1.5 rounded-md border border-hairline text-red-500 text-xs font-medium disabled:opacity-50"
          >
            {t("reject")}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-red-500 text-xs mt-2">{t(`errors.${error}`)}</p> : null}
    </div>
  );
}
