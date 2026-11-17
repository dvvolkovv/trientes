"use client";

import { useState, useTransition } from "react";
import { decideCase, markReviewed } from "@/app/actions/case-review";
import { ADMIN_BUTTON, ADMIN_BUTTON_DANGER, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";

export type DecisionLabels = {
  review: string;
  reviewedBy: string;
  approve: string;
  reject: string;
  reasonPlaceholder: string;
  soleHint: string;
  rejectHint: string;
  closedWithoutDecision: string;
  /** Подпись вместо кнопок решения тому, у кого права решать нет. */
  noDecideRight: string;
  /** Причина недоступности кнопки — строкой под кнопкой, как велит спека. */
  blockers: Record<string, string>;
  errors: Record<string, string>;
};

/**
 * Две подписи. Причина, по которой «Одобрить» недоступно, написана прямо под
 * кнопкой: спрятанная в подсказку, она на телефоне не читается вовсе.
 */
export function CaseDecision({
  caseId,
  reviewedByName,
  approveBlockers,
  reviewBlockers,
  wouldBeSole,
  canDecide,
  labels,
}: {
  caseId: string;
  reviewedByName: string | null;
  approveBlockers: string[];
  reviewBlockers: string[];
  wouldBeSole: boolean;
  /** Решение — право «утверждает»; ведущий дело видит только первую подпись. */
  canDecide: boolean;
  labels: DecisionLabels;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; reason?: string; closedWithoutDecision?: boolean }>) {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(labels.errors[res.reason ?? "failed"] ?? labels.blockers[res.reason ?? ""] ?? labels.errors.failed);
        return;
      }
      if (res.closedWithoutDecision) setNotice(labels.closedWithoutDecision);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {reviewedByName ? (
        <div className="text-[12px] text-muted">
          {labels.reviewedBy.replace("{name}", reviewedByName)}
        </div>
      ) : (
        <div>
          <button
            type="button"
            disabled={pending || reviewBlockers.length > 0}
            className={ADMIN_BUTTON_SECONDARY}
            onClick={() => run(() => markReviewed({ caseId }))}
          >
            {labels.review}
          </button>
          {reviewBlockers.map((b) => (
            <p key={b} className="mt-1.5 text-[11px] leading-snug text-muted">
              {labels.blockers[b] ?? b}
            </p>
          ))}
        </div>
      )}

      {canDecide ? (
      <>
      <div>
        <button
          type="button"
          disabled={pending || approveBlockers.length > 0}
          className={ADMIN_BUTTON}
          onClick={() => run(() => decideCase({ caseId, decision: "APPROVED", reason }))}
        >
          {labels.approve}
        </button>
        {approveBlockers.map((b) => (
          <p key={b} className="mt-1.5 text-[11px] leading-snug text-muted">
            {labels.blockers[b] ?? b}
          </p>
        ))}
        {approveBlockers.length === 0 && wouldBeSole ? (
          <p className="mt-1.5 text-[11px] leading-snug text-[#e2a33c]">{labels.soleHint}</p>
        ) : null}
      </div>

      <div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={labels.reasonPlaceholder}
          rows={2}
          className="mb-2 w-full resize-none rounded-[14px] border border-hairline bg-card-alt p-3 text-[12.5px] outline-none focus:border-accent/60"
        />
        <button
          type="button"
          disabled={pending}
          className={ADMIN_BUTTON_DANGER}
          onClick={() => run(() => decideCase({ caseId, decision: "REJECTED", reason }))}
        >
          {labels.reject}
        </button>
        <p className="mt-1.5 text-[11px] leading-snug text-muted">{labels.rejectHint}</p>
      </div>
      </>
      ) : (
        <p className="text-[11px] leading-snug text-muted">{labels.noDecideRight}</p>
      )}

      {notice ? <p className="text-[11px] leading-snug text-muted">{notice}</p> : null}
      {error ? <p className="text-[11px] text-down">{error}</p> : null}
    </div>
  );
}
