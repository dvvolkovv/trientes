"use client";

import { useState, useTransition } from "react";
import { createStaffInvite, revokeStaffInvite } from "@/app/actions/staff-invites";
import { grantStaffByIdentifier } from "@/app/actions/staff-access";
import { ADMIN_BUTTON, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";
import type { PresetKey } from "@/lib/staff/presets";
import { GrantMatrix, type MatrixLabels, type MatrixValue } from "./staff-grant-matrix";

export type InviteLabels = {
  titleField: string;
  titlePlaceholder: string;
  dutiesField: string;
  dutiesPlaceholder: string;
  expiresField: string;
  expiresHint: string;
  byLink: string;
  byIdentifier: string;
  identifierField: string;
  identifierHint: string;
  create: string;
  grant: string;
  granted: string;
  linkOnce: string;
  copy: string;
  copied: string;
  expiresIn: string;
  activeTitle: string;
  activeEmpty: string;
  revokeInvite: string;
  matrix: MatrixLabels;
  errors: Record<string, string>;
};

/** `line` собирается на сервере: там же, где форматируется дата. */
export type ActiveInvite = { id: string; line: string };

/**
 * Две двери, как в командах предприятий: ссылкой — тому, у кого аккаунта нет,
 * по логину — тому, у кого он есть. Права отмечаются до приглашения и
 * применяются в момент принятия.
 */
export function StaffInviteForm({
  presets,
  empty,
  invites,
  labels,
  inviteOrigin,
  locale,
}: {
  presets: { key: PresetKey; levels: MatrixValue }[];
  /** Пустая матрица: все восемь очередей без доступа. */
  empty: MatrixValue;
  invites: ActiveInvite[];
  labels: InviteLabels;
  inviteOrigin: string;
  locale: string;
}) {
  const [mode, setMode] = useState<"link" | "identifier">("link");
  const [levels, setLevels] = useState<MatrixValue>(empty);
  const [title, setTitle] = useState("");
  const [duties, setDuties] = useState("");
  const [expires, setExpires] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [granted, setGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const picked = Object.entries(levels).filter(([, level]) => level !== null);

  function grants() {
    return picked.map(([queue, level]) => ({
      queue,
      level: level as string,
      // Срок один на весь пакет: «до конца проверки» относится ко всему доступу,
      // а не к отдельной очереди.
      expiresAt: expires ? new Date(expires).toISOString() : null,
    }));
  }

  function submit() {
    setError(null);
    setLink(null);
    setGranted(false);
    setCopied(false);
    start(async () => {
      if (mode === "identifier") {
        const res = await grantStaffByIdentifier({
          identifier: identifier.trim(),
          title: title.trim() || undefined,
          duties: duties.trim() || undefined,
          grants: grants(),
        });
        if (!res.ok) return setError(labels.errors[res.reason] ?? labels.errors.failed);
        setGranted(true);
        setIdentifier("");
        return;
      }
      const res = await createStaffInvite({
        identifier: identifier.trim() || undefined,
        title: title.trim() || undefined,
        duties: duties.trim() || undefined,
        grants: grants(),
      });
      if (!res.ok) return setError(labels.errors[res.reason] ?? labels.errors.failed);
      setLink(`${inviteOrigin}/${locale}/staff-invite/${res.token}`);
    });
  }

  function revoke(id: string) {
    setError(null);
    start(async () => {
      const res = await revokeStaffInvite({ inviteId: id });
      if (!res.ok) setError(labels.errors[res.reason] ?? labels.errors.failed);
    });
  }

  return (
    <div className="rounded-[20px] border border-hairline bg-card p-4">
      <div className="mb-3 flex gap-2">
        {(["link", "identifier"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            className={
              mode === key
                ? "rounded-full bg-foreground px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-bg"
                : "rounded-full border border-hairline bg-card px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted"
            }
          >
            {key === "link" ? labels.byLink : labels.byIdentifier}
          </button>
        ))}
      </div>

      <GrantMatrix value={levels} onChange={setLevels} labels={labels.matrix} presets={presets} />

      <div className="mb-3 flex flex-col gap-2.5">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {labels.titleField}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={labels.titlePlaceholder}
            maxLength={120}
            className="h-12 w-full rounded-[14px] border border-hairline bg-bg-tint px-3 text-[13px] text-foreground outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {labels.dutiesField}
          <textarea
            value={duties}
            onChange={(e) => setDuties(e.target.value)}
            placeholder={labels.dutiesPlaceholder}
            rows={3}
            maxLength={2000}
            className="w-full rounded-[14px] border border-hairline bg-bg-tint p-3 text-[13px] text-foreground outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {labels.expiresField}
          <input
            type="date"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            className="h-12 w-full rounded-[14px] border border-hairline bg-bg-tint px-3 text-[13px] text-foreground outline-none focus:border-accent"
          />
          <span className="text-[11px] leading-snug">{labels.expiresHint}</span>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          {labels.identifierField}
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            maxLength={200}
            className="h-12 w-full rounded-[14px] border border-hairline bg-bg-tint px-3 text-[13px] text-foreground outline-none focus:border-accent"
          />
          <span className="text-[11px] leading-snug">{labels.identifierHint}</span>
        </label>
      </div>

      <button
        type="button"
        disabled={
          pending || picked.length === 0 || (mode === "identifier" && identifier.trim().length === 0)
        }
        className={ADMIN_BUTTON}
        onClick={submit}
      >
        {mode === "link" ? labels.create : labels.grant}
      </button>

      {error ? <p className="mt-2 text-[12px] leading-snug text-down">{error}</p> : null}
      {granted ? <p className="mt-2 text-[12px] text-up">{labels.granted}</p> : null}

      {link ? (
        <div className="mt-3 rounded-[14px] border border-hairline bg-bg-tint p-3">
          <p className="mb-2 text-[11px] leading-snug text-muted">{labels.linkOnce}</p>
          <code className="num mb-2 block break-all text-[11px]">{link}</code>
          <button
            type="button"
            className={ADMIN_BUTTON_SECONDARY}
            onClick={() => {
              void navigator.clipboard?.writeText(link);
              setCopied(true);
            }}
          >
            {copied ? labels.copied : labels.copy}
          </button>
          <p className="mt-2 text-[11px] leading-snug text-muted">{labels.expiresIn}</p>
        </div>
      ) : null}

      <div className="mt-4 border-t border-hairline pt-3">
        <div className="mb-1.5 text-[9.5px] uppercase tracking-[0.15em] text-muted">
          {labels.activeTitle}
        </div>
        {invites.length === 0 ? (
          <p className="text-[12px] text-muted">{labels.activeEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {invites.map((inv) => (
              <li key={inv.id} className="flex flex-col gap-1.5">
                <span className="text-[12px]">{inv.line}</span>
                <button
                  type="button"
                  disabled={pending}
                  className={ADMIN_BUTTON_SECONDARY}
                  onClick={() => revoke(inv.id)}
                >
                  {labels.revokeInvite}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
