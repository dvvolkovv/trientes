"use client";

import { useState, useTransition } from "react";
import type { CaseCheckState } from "@prisma/client";
import { setCaseCheck } from "@/app/actions/case-review";
import { noteRequired } from "@/lib/cases/checklists";

export type ChecklistItem = {
  key: string;
  label: string;
  required: boolean;
  state: CaseCheckState;
  note: string | null;
  checkedByName: string | null;
};

export type ChecklistLabels = {
  required: string;
  hint: string;
  state: Record<string, string>;
  set: Record<string, string>;
  notePlaceholder: string;
  errors: Record<string, string>;
};

const SETTABLE: CaseCheckState[] = ["OK", "FAIL", "NA"];

const PILL: Record<string, string> = {
  TODO: "bg-card-alt text-muted",
  OK: "bg-up/15 text-up",
  FAIL: "bg-down/15 text-down",
  NA: "bg-card-alt text-muted-strong",
};

function Item({
  caseId,
  item,
  labels,
  readOnly,
}: {
  caseId: string;
  item: ChecklistItem;
  labels: ChecklistLabels;
  /** Смотрящий видит отметки, но не ставит их. */
  readOnly?: boolean;
}) {
  const [note, setNote] = useState(item.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(state: CaseCheckState) {
    setError(null);
    start(async () => {
      const res = await setCaseCheck({ caseId, key: item.key, state, note });
      if (!res.ok) setError(labels.errors[res.reason] ?? labels.errors.failed);
    });
  }

  return (
    <div className="border-b border-hairline py-3 last:border-b-0">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="text-[12.5px] leading-snug">
          {item.label}
          {item.required ? (
            <span className="ml-1.5 text-[10px] uppercase tracking-wider text-muted">
              {labels.required}
            </span>
          ) : null}
          {item.checkedByName ? (
            <div className="text-[10.5px] text-muted">{item.checkedByName}</div>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${PILL[item.state]}`}
        >
          {labels.state[item.state]}
        </span>
      </div>

      {readOnly ? (
        item.note ? <p className="text-[11px] text-muted">{item.note}</p> : null
      ) : (
        <>
      {/* Примечание нужно до нажатия: «проблема» и «не применимо» без причины не сохранятся. */}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={labels.notePlaceholder}
        className="mb-2 h-10 w-full rounded-[12px] border border-hairline bg-card-alt px-3 text-[12px] outline-none focus:border-accent/60"
      />

      <div className="grid grid-cols-3 gap-2">
        {SETTABLE.map((state) => (
          <button
            key={state}
            type="button"
            disabled={pending}
            onClick={() => save(state)}
            className={`flex h-12 items-center justify-center rounded-[12px] border px-2 text-[12px] font-semibold transition-colors disabled:opacity-40 ${
              item.state === state
                ? "border-accent bg-accent/10 text-foreground"
                : "border-hairline bg-card text-muted-strong hover:bg-card-alt"
            }`}
          >
            {labels.set[state]}
          </button>
        ))}
      </div>

      {item.note && noteRequired(item.state) ? (
        <p className="mt-2 text-[11px] text-muted">{item.note}</p>
      ) : null}
      {error ? <p className="mt-2 text-[11px] text-down">{error}</p> : null}
        </>
      )}
    </div>
  );
}

export function CaseChecklist({
  caseId,
  items,
  labels,
  readOnly,
}: {
  caseId: string;
  items: ChecklistItem[];
  labels: ChecklistLabels;
  readOnly?: boolean;
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] leading-snug text-muted">{labels.hint}</p>
      {items.map((item) => (
        <Item key={item.key} caseId={caseId} item={item} labels={labels} readOnly={readOnly} />
      ))}
    </div>
  );
}
