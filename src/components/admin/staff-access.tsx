"use client";

import { useState, useTransition } from "react";
import {
  markAccessReviewPassed,
  restoreStaffAccess,
  revokeStaffAccess,
  setStaffGrants,
} from "@/app/actions/staff-access";
import { ADMIN_BUTTON, ADMIN_BUTTON_DANGER, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";
import { GrantMatrix, type MatrixLabels, type MatrixValue } from "./staff-grant-matrix";

export type StaffAccessLabels = {
  noTitle: string;
  queues: string;
  none: string;
  save: string;
  saved: string;
  revoke: string;
  revokePlaceholder: string;
  restore: string;
  passReview: string;
  edit: string;
  cancel: string;
  matrix: MatrixLabels;
  errors: Record<string, string>;
};

export type StaffRow = {
  userId: string;
  who: string;
  title: string | null;
  levels: MatrixValue;
  /** Готовая строка о сроке пересмотра: дату форматирует сервер, а не браузер. */
  reviewLine: string;
  reviewOverdue: boolean;
  revokedLine: string | null;
  revokeReasonLine: string | null;
};

/**
 * Строка сотрудника: кто, должность, права по очередям и три действия. Правка
 * прав — та же матрица, что в приглашении (`GrantMatrix`): выдача и правка
 * должны выглядеть одинаково, иначе владелец ищет в них разный смысл.
 */
export function StaffAccessRow({ row, labels }: { row: StaffRow; labels: StaffAccessLabels }) {
  const [levels, setLevels] = useState<MatrixValue>(row.levels);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function fail(reason: string) {
    setError(labels.errors[reason] ?? labels.errors.failed);
  }

  function save() {
    setError(null);
    setDone(false);
    const grants = Object.entries(levels)
      .filter(([, level]) => level !== null)
      .map(([queue, level]) => ({ queue, level: level as string }));
    start(async () => {
      const res = await setStaffGrants({ userId: row.userId, grants });
      if (!res.ok) return fail(res.reason);
      setEditing(false);
      setDone(true);
    });
  }

  function run(which: "revoke" | "restore" | "review") {
    setError(null);
    setDone(false);
    start(async () => {
      const res =
        which === "revoke"
          ? await revokeStaffAccess({ userId: row.userId, reason: reason.trim() })
          : which === "restore"
            ? await restoreStaffAccess({ userId: row.userId })
            : await markAccessReviewPassed({ userId: row.userId });
      if (!res.ok) return fail(res.reason);
      setReason("");
      setDone(true);
    });
  }

  const granted = Object.entries(row.levels).filter(([, level]) => level !== null);

  return (
    <div className="rounded-[20px] border border-hairline bg-card p-4">
      <b className="block text-[15px] font-semibold">{row.who}</b>
      <div className="mb-3 text-[12px] text-muted">{row.title ?? labels.noTitle}</div>

      {row.revokedLine ? (
        <div className="mb-3 rounded-[14px] border border-down/40 bg-down/10 p-3 text-[12px] leading-snug text-down">
          <div>{row.revokedLine}</div>
          {row.revokeReasonLine ? <div>{row.revokeReasonLine}</div> : null}
        </div>
      ) : null}

      {editing ? (
        <GrantMatrix value={levels} onChange={setLevels} labels={labels.matrix} />
      ) : (
        <div className="mb-3">
          <div className="mb-1 text-[9.5px] uppercase tracking-[0.15em] text-muted">
            {labels.queues}
          </div>
          {granted.length === 0 ? (
            <div className="text-[13px] text-muted">{labels.none}</div>
          ) : (
            <ul className="flex flex-col gap-0.5 text-[13px]">
              {granted.map(([queue, level]) => (
                <li key={queue}>
                  {labels.matrix.queues[queue] ?? queue} —{" "}
                  <span className="font-semibold">{labels.matrix.levels[level as string]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className={`mb-3 text-[12px] ${row.reviewOverdue ? "text-down" : "text-muted"}`}>
        {row.reviewLine}
      </p>

      <div className="flex flex-col gap-2.5">
        {editing ? (
          <>
            <button type="button" disabled={pending} className={ADMIN_BUTTON} onClick={save}>
              {labels.save}
            </button>
            <button
              type="button"
              disabled={pending}
              className={ADMIN_BUTTON_SECONDARY}
              onClick={() => {
                setLevels(row.levels);
                setEditing(false);
              }}
            >
              {labels.cancel}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={pending}
              className={ADMIN_BUTTON_SECONDARY}
              onClick={() => setEditing(true)}
            >
              {labels.edit}
            </button>
            <button
              type="button"
              disabled={pending}
              className={ADMIN_BUTTON_SECONDARY}
              onClick={() => run("review")}
            >
              {labels.passReview}
            </button>
            {row.revokedLine ? (
              <button
                type="button"
                disabled={pending}
                className={ADMIN_BUTTON}
                onClick={() => run("restore")}
              >
                {labels.restore}
              </button>
            ) : (
              <>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={labels.revokePlaceholder}
                  maxLength={400}
                  className="h-12 w-full rounded-[14px] border border-hairline bg-bg-tint px-3 text-[13px] outline-none focus:border-accent"
                />
                <button
                  type="button"
                  disabled={pending || reason.trim().length < 3}
                  className={ADMIN_BUTTON_DANGER}
                  onClick={() => run("revoke")}
                >
                  {labels.revoke}
                </button>
              </>
            )}
          </>
        )}
      </div>

      {error ? <p className="mt-2 text-[12px] leading-snug text-down">{error}</p> : null}
      {done ? <p className="mt-2 text-[12px] text-up">{labels.saved}</p> : null}
    </div>
  );
}
