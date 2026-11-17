"use client";

import { useState, useTransition } from "react";
import type { CaseDocumentVerdict } from "@prisma/client";
import { setDocumentVerdict } from "@/app/actions/case-review";

export type CaseDocumentItem = {
  id: string;
  kindLabel: string;
  label: string;
  url: string;
  verdict: CaseDocumentVerdict;
  note: string | null;
};

export type DocumentLabels = {
  verdict: Record<string, string>;
  set: Record<string, string>;
  notePlaceholder: string;
  open: string;
  errors: Record<string, string>;
};

const SETTABLE: CaseDocumentVerdict[] = ["ACCEPTED", "REJECTED", "RESUBMIT"];

const PILL: Record<string, string> = {
  PENDING: "bg-card-alt text-muted",
  ACCEPTED: "bg-up/15 text-up",
  REJECTED: "bg-down/15 text-down",
  RESUBMIT: "bg-[#e2a33c]/20 text-[#e2a33c]",
};

function Row({
  doc,
  labels,
}: {
  doc: CaseDocumentItem;
  labels: DocumentLabels;
}) {
  const [note, setNote] = useState(doc.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(verdict: CaseDocumentVerdict) {
    setError(null);
    start(async () => {
      const res = await setDocumentVerdict({ documentId: doc.id, verdict, note });
      if (!res.ok) setError(labels.errors[res.reason] ?? labels.errors.failed);
    });
  }

  return (
    <div className="border-b border-hairline py-3 last:border-b-0">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-semibold">{doc.label}</div>
          <div className="text-[10.5px] text-muted">{doc.kindLabel}</div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${PILL[doc.verdict]}`}
        >
          {labels.verdict[doc.verdict]}
        </span>
      </div>

      <a
        href={doc.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-2 flex h-12 w-full items-center justify-center rounded-[12px] border border-hairline bg-card-alt px-3 text-[12px] font-semibold text-foreground"
      >
        {labels.open}
      </a>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={labels.notePlaceholder}
        className="mb-2 h-10 w-full rounded-[12px] border border-hairline bg-card-alt px-3 text-[12px] outline-none focus:border-accent/60"
      />

      <div className="grid grid-cols-3 gap-2">
        {SETTABLE.map((verdict) => (
          <button
            key={verdict}
            type="button"
            disabled={pending}
            onClick={() => save(verdict)}
            className={`flex h-12 items-center justify-center rounded-[12px] border px-2 text-[11.5px] font-semibold leading-tight transition-colors disabled:opacity-40 ${
              doc.verdict === verdict
                ? "border-accent bg-accent/10 text-foreground"
                : "border-hairline bg-card text-muted-strong hover:bg-card-alt"
            }`}
          >
            {labels.set[verdict]}
          </button>
        ))}
      </div>

      {doc.note ? <p className="mt-2 text-[11px] text-muted">{doc.note}</p> : null}
      {error ? <p className="mt-2 text-[11px] text-down">{error}</p> : null}
    </div>
  );
}

export function CaseDocuments({
  docs,
  labels,
  emptyLabel,
}: {
  docs: CaseDocumentItem[];
  labels: DocumentLabels;
  emptyLabel: string;
}) {
  if (docs.length === 0) {
    return <p className="text-[12px] leading-snug text-muted">{emptyLabel}</p>;
  }
  return (
    <div>
      {docs.map((doc) => (
        <Row key={doc.id} doc={doc} labels={labels} />
      ))}
    </div>
  );
}
