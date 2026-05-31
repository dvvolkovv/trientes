"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { KybStatus } from "@prisma/client";
import { submitKyb, withdrawKyb } from "@/app/actions/kyb";

type Kind = "REGISTRATION_CERT" | "TAX_CERT" | "ID" | "OTHER";
export type KybDoc = { kind: Kind; url: string; label?: string | null };
type Doc = KybDoc;

const KINDS: Kind[] = ["REGISTRATION_CERT", "TAX_CERT", "ID", "OTHER"];

export function KybForm({
  companyId,
  initialDocs,
  status,
}: {
  companyId: string;
  initialDocs: Doc[];
  status: KybStatus;
}) {
  const t = useTranslations("business.kyb");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [docs, setDocs] = useState<Doc[]>(
    initialDocs.length > 0
      ? initialDocs.map((d) => ({ kind: (KINDS.includes(d.kind as Kind) ? (d.kind as Kind) : "OTHER"), url: d.url, label: d.label ?? "" }))
      : [{ kind: "REGISTRATION_CERT", url: "", label: "" }]
  );
  const [error, setError] = useState<string | null>(null);

  function updateDoc(i: number, patch: Partial<Doc>) {
    setDocs((arr) => arr.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }
  function addDoc() {
    if (docs.length >= 8) return;
    setDocs((arr) => [...arr, { kind: "OTHER", url: "", label: "" }]);
  }
  function removeDoc(i: number) {
    setDocs((arr) => arr.filter((_, idx) => idx !== i));
  }

  function submit() {
    setError(null);
    const payload = docs
      .map((d) => ({ ...d, url: d.url.trim(), label: d.label?.trim() || null }))
      .filter((d) => d.url.length > 0);
    if (payload.length === 0) {
      setError("invalid");
      return;
    }
    startTransition(async () => {
      const r = await submitKyb({ companyId, documents: payload });
      if (r.ok) router.refresh();
      else setError(r.reason);
    });
  }

  function withdraw() {
    startTransition(async () => {
      const r = await withdrawKyb({ companyId });
      if (r.ok) router.refresh();
      else setError(r.reason);
    });
  }

  return (
    <div className="space-y-3">
      {docs.map((d, i) => (
        <div key={i} className="grid grid-cols-[160px_1fr_1fr_auto] gap-2 items-center">
          <select
            value={d.kind}
            onChange={(e) => updateDoc(i, { kind: e.target.value as Kind })}
            className="px-2 py-1.5 rounded-md border border-hairline bg-bg-tint text-sm"
          >
            {KINDS.map((k) => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}
          </select>
          <input
            value={d.url}
            onChange={(e) => updateDoc(i, { url: e.target.value })}
            placeholder={t("urlPlaceholder")}
            className="px-2 py-1.5 rounded-md border border-hairline bg-bg-tint text-sm"
          />
          <input
            value={d.label ?? ""}
            onChange={(e) => updateDoc(i, { label: e.target.value })}
            placeholder={t("labelPlaceholder")}
            className="px-2 py-1.5 rounded-md border border-hairline bg-bg-tint text-sm"
          />
          <button
            type="button"
            onClick={() => removeDoc(i)}
            disabled={docs.length === 1}
            className="text-xs px-2 py-1 rounded-md border border-hairline text-muted disabled:opacity-30"
          >
            ✕
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addDoc}
        disabled={docs.length >= 8}
        className="text-xs px-3 py-1 rounded-md border border-hairline text-muted disabled:opacity-50"
      >
        + {t("addDocument")}
      </button>

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
        >
          {pending ? t("submitting") : status === "PENDING" || status === "REJECTED" ? t("resubmit") : t("submit")}
        </button>
        {status === "PENDING" || status === "REJECTED" ? (
          <button
            type="button"
            onClick={withdraw}
            disabled={pending}
            className="px-3 py-2 rounded-md border border-hairline text-sm text-muted disabled:opacity-50"
          >
            {t("withdraw")}
          </button>
        ) : null}
      </div>

      {error ? <p className="text-red-500 text-xs">{t(`errors.${error}`)}</p> : null}
    </div>
  );
}
