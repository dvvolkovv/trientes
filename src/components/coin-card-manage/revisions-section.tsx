"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { DiffEntry } from "@/lib/coin-card-diff";
import { DiffView } from "./diff-view";
import { voteOnRevision, withdrawRevision } from "@/app/actions/coin-card-revisions";

export type RevisionItem = {
  id: string;
  kind: "CONTENT" | "POLICY";
  section: string | null;
  status: string;
  highRisk: boolean;
  diff: DiffEntry[];
  thresholdAt: number | null;
  signerCountAt: number | null;
  approvals: number;
  rejections: number;
  myVote: "APPROVE" | "REJECT" | null;
  isMine: boolean;
  authorLabel: string;
  createdAt: string;
  adminNote: string | null;
};

export function RevisionsSection({
  revisions,
  canVote,
}: {
  revisions: RevisionItem[];
  canVote: boolean;
}) {
  const t = useTranslations("coinCard.revision");
  const router = useRouter();
  const [pending, start] = useTransition();
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
    <section id="revisions">
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h2>
      <p className="text-sm text-muted mb-4">{t("subtitle")}</p>

      {revisions.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-3">
          {revisions.map((r) => (
            <li key={r.id} className="border border-hairline rounded-md p-3 bg-card-alt">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="num text-[11px] uppercase tracking-[0.12em] text-muted">
                  {r.kind === "POLICY" ? t("policyChange") : r.section}
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-bg-tint">
                  {t(`status.${r.status}`)}
                </span>
                {r.highRisk ? (
                  <span className="text-[10px] uppercase tracking-[0.12em] text-red-400">
                    {t("highRisk")}
                  </span>
                ) : null}
                <span className="text-[11px] text-muted">
                  {t("author", { author: r.authorLabel })}
                </span>
                {r.thresholdAt ? (
                  <span className="text-[11px] text-muted">
                    {t("signatures", {
                      approvals: r.approvals,
                      threshold: r.thresholdAt,
                      rejections: r.rejections,
                    })}
                  </span>
                ) : null}
                <span className="text-[11px] text-muted ml-auto">
                  {r.createdAt.slice(0, 10)}
                </span>
              </div>

              <DiffView diff={r.diff} />

              {r.adminNote ? (
                <p className="text-xs text-muted mt-2">{t("adminNote", { note: r.adminNote })}</p>
              ) : null}

              <div className="flex flex-wrap gap-2 mt-3">
                {r.status === "PENDING_SIGNERS" && canVote && !r.myVote ? (
                  <>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(() => voteOnRevision({ revisionId: r.id, decision: "APPROVE" }))
                      }
                      className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-medium disabled:opacity-50"
                    >
                      {t("approve")}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(() => voteOnRevision({ revisionId: r.id, decision: "REJECT" }))
                      }
                      className="px-3 py-1.5 rounded-md border border-hairline text-red-500 text-xs font-medium disabled:opacity-50"
                    >
                      {t("reject")}
                    </button>
                  </>
                ) : null}
                {r.myVote ? (
                  <span className="text-xs text-muted">{t(`voted.${r.myVote}`)}</span>
                ) : null}
                {r.isMine && (r.status === "PENDING_SIGNERS" || r.status === "PENDING_ADMIN") ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => withdrawRevision({ revisionId: r.id }))}
                    className="px-3 py-1.5 rounded-md border border-hairline text-xs disabled:opacity-50"
                  >
                    {t("withdraw")}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="text-red-500 text-xs mt-2">{t(`errors.${error}`)}</p> : null}
    </section>
  );
}
