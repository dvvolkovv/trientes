"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { CoinCardRole } from "@prisma/client";
import { createCardInvite, revokeCardInvite } from "@/app/actions/coin-card-invites";
import { buildCardInviteUrl } from "@/lib/coin-card-invites";

export type CardInviteItem = {
  id: string;
  token: string;
  role: CoinCardRole;
  isSigner: boolean;
  expiresAt: string; // ISO — Date can't cross the server/client boundary
};

export function CardInviteLinks({
  cardId,
  invites,
  canAssignOwner,
}: {
  cardId: string;
  invites: CardInviteItem[];
  canAssignOwner: boolean;
}) {
  const t = useTranslations("coinCard.team.invites");
  const tr = useTranslations("coinCard.team");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [role, setRole] = useState<CoinCardRole>("EDITOR");
  const [signer, setSigner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // The path renders identically on server and client; the absolute URL is
  // built at click time, where window actually exists.
  const pathFor = (token: string) => `/${locale}/invite/coin/${token}`;

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(
        buildCardInviteUrl(window.location.origin, locale, token),
      );
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="mt-4 border border-hairline rounded-md p-3 bg-card-alt">
      <h3 className="text-sm font-semibold mb-1">{t("title")}</h3>
      <p className="text-xs text-muted mb-3">{t("subtitle")}</p>

      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as CoinCardRole)}
          className="px-3 py-2 rounded-md border border-hairline bg-bg-tint text-sm"
        >
          <option value="VIEWER">{tr("role.VIEWER")}</option>
          <option value="EDITOR">{tr("role.EDITOR")}</option>
          <option value="ADMIN">{tr("role.ADMIN")}</option>
          {canAssignOwner ? <option value="OWNER">{tr("role.OWNER")}</option> : null}
        </select>
        {canAssignOwner ? (
          <label className="text-xs flex items-center gap-1">
            <input type="checkbox" checked={signer} onChange={(e) => setSigner(e.target.checked)} />
            {tr("signer")}
          </label>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              const r = await createCardInvite({ cardId, role, isSigner: signer });
              if (r.ok) router.refresh();
              else setError(r.reason);
            });
          }}
          className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
        >
          {pending ? t("creating") : t("create")}
        </button>
      </div>
      {error ? <p className="text-red-500 text-xs mt-2">{t(`errors.${error}`)}</p> : null}

      {invites.length === 0 ? (
        <p className="text-xs text-muted mt-3">{t("empty")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {invites.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-wrap items-center gap-2 text-xs border border-hairline rounded-md px-2 py-2 bg-bg-tint"
            >
              <span className="px-2 py-1 rounded bg-card text-[11px] uppercase tracking-[0.1em]">
                {tr(`role.${inv.role}`)}
              </span>
              {inv.isSigner ? <span className="text-accent">{tr("signer")}</span> : null}
              <code className="flex-1 min-w-[160px] truncate" title={pathFor(inv.token)}>
                {pathFor(inv.token)}
              </code>
              <span className="text-muted whitespace-nowrap">
                {t("expires", { date: new Date(inv.expiresAt).toLocaleDateString(locale) })}
              </span>
              <button
                type="button"
                onClick={() => void copy(inv.token)}
                className="px-2 py-1 rounded border border-hairline hover:bg-card"
              >
                {copied === inv.token ? t("copied") : t("copy")}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const r = await revokeCardInvite({ cardId, inviteId: inv.id });
                    if (r.ok) router.refresh();
                    else setError(r.reason);
                  });
                }}
                className="px-2 py-1 rounded border border-hairline text-red-500 hover:bg-card disabled:opacity-50"
              >
                {t("revoke")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
