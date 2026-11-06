"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  SECTION_SPECS,
  specToInitial,
  stateToPayload,
  type FieldSpec,
  type FormState,
} from "@/lib/coin-card-form-spec";
import type { CardSection } from "@/lib/coin-card-risk";
import { saveCoinCardSection } from "@/app/actions/coin-card";
import { submitSectionRevision } from "@/app/actions/coin-card-revisions";
import { LogoUpload } from "@/components/coin-card-wizard/logo-upload";

const inputCls = "w-full px-3 py-2 rounded-md border border-hairline bg-bg-tint text-sm";
const labelCls = "num text-[10px] uppercase tracking-[0.14em] text-muted";

function Scalar({
  field,
  value,
  onChange,
  label,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  label: string;
}) {
  if (field.kind === "bool") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    );
  }
  if (field.kind === "select") {
    return (
      <label className="block">
        <span className={labelCls}>{label}</span>
        <select
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} mt-1`}
        >
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const multiline = field.kind === "textarea" || field.kind === "lines";
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {multiline ? (
        <textarea
          rows={field.kind === "textarea" ? 6 : 3}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} mt-1`}
        />
      ) : (
        <input
          type={field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text"}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} mt-1`}
        />
      )}
    </label>
  );
}

/**
 * One form for every section, driven by SECTION_SPECS. Submits through the
 * revision pipeline for a published card and straight to the card while it is
 * still a draft — the server re-checks both, this only picks the action.
 */
export function SectionEditor({
  cardId,
  section,
  card,
  published,
}: {
  cardId: string;
  section: CardSection;
  card: unknown;
  published: boolean;
}) {
  const spec = SECTION_SPECS[section];
  const t = useTranslations("coinCard.wizard");
  const tm = useTranslations("coinCard.manage");
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => specToInitial(spec, card));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const set = (path: string, v: unknown) => setState((s) => ({ ...s, [path]: v }));

  const setRow = (path: string, i: number, sub: string, v: unknown) =>
    setState((s) => {
      const rows = [...((s[path] as Record<string, unknown>[]) ?? [])];
      rows[i] = { ...rows[i], [sub]: v };
      return { ...s, [path]: rows };
    });

  const addRow = (f: Extract<FieldSpec, { kind: "rows" }>) =>
    setState((s) => {
      const rows = [...((s[f.path] as Record<string, unknown>[]) ?? [])];
      const blank: Record<string, unknown> = {};
      for (const sub of f.fields) {
        blank[sub.path] =
          sub.kind === "bool" ? false : sub.kind === "select" ? sub.options[0] : "";
      }
      return { ...s, [f.path]: [...rows, blank] };
    });

  const dropRow = (path: string, i: number) =>
    setState((s) => {
      const rows = [...((s[path] as Record<string, unknown>[]) ?? [])];
      rows.splice(i, 1);
      return { ...s, [path]: rows };
    });

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setDone(null);
        const payload = stateToPayload(spec, state);
        start(async () => {
          const res = published
            ? await submitSectionRevision({ cardId, section, payload })
            : await saveCoinCardSection({ cardId, section, payload });
          if (!res.ok) {
            setError(res.reason);
            return;
          }
          setDone("status" in res ? String(res.status) : "SAVED");
          router.refresh();
        });
      }}
    >
      {spec.map((f) =>
        f.kind === "rows" ? (
          <div key={f.path} className="space-y-3">
            <span className={labelCls}>{t(f.label)}</span>
            {((state[f.path] as Record<string, unknown>[]) ?? []).map((row, i) => (
              <div key={i} className="border border-hairline rounded-md p-3 space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  {f.fields.map((sub) => (
                    <Scalar
                      key={sub.path}
                      field={sub}
                      label={t(sub.label)}
                      value={row[sub.path]}
                      onChange={(v) => setRow(f.path, i, sub.path, v)}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => dropRow(f.path, i)}
                  className="text-xs text-red-500"
                >
                  {tm("removeRow")}
                </button>
              </div>
            ))}
            <button type="button" onClick={() => addRow(f)} className="text-accent text-sm">
              + {tm("addRow")}
            </button>
          </div>
        ) : f.kind === "logo" ? (
          <div key={f.path} className="flex items-center gap-4 flex-wrap">
            {state[f.path] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={String(state[f.path])}
                alt=""
                width={48}
                height={48}
                className="rounded-full border border-hairline"
              />
            ) : null}
            <LogoUpload cardId={cardId} onUploaded={(url) => set(f.path, url)} />
          </div>
        ) : (
          <Scalar
            key={f.path}
            field={f}
            label={t(f.label)}
            value={state[f.path]}
            onChange={(v) => set(f.path, v)}
          />
        ),
      )}

      {error ? <p className="text-down text-sm">{tm(`errors.${error}`)}</p> : null}
      {done ? <p className="text-up text-sm">{tm(`submitted.${done}`)}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
      >
        {pending ? tm("saving") : published ? tm("submitChange") : tm("save")}
      </button>
    </form>
  );
}
