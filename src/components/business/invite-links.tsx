"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { CompanyRole } from "@prisma/client";
import { createInvite, revokeInvite } from "@/app/actions/company-invites";
import { buildInviteUrl } from "@/lib/company-invites";

export type InviteListItem = {
  id: string;
  token: string;
  role: CompanyRole;
  expiresAt: string; // ISO — Date objects can't cross the server/client boundary
};

export function InviteLinks({
  companyId,
  invites,
}: {
  companyId: string;
  invites: InviteListItem[];
}) {
  const t = useTranslations("business.members.invites");
  // Role labels live one level up — shared with the member list.
  const tr = useTranslations("business.members");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [role, setRole] = useState<CompanyRole>("EDITOR");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Rendered server-side too, where window is absent — fill in after mount so
  // the markup matches on hydration.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  function urlFor(token: string) {
    return origin ? buildInviteUrl(origin, locale, token) : `/${locale}/invite/${token}`;
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(urlFor(token));
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

      <div className="flex flex-wrap gap-2 items-stretch">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as CompanyRole)}
          className="px-3 py-2 rounded-md border border-hairline bg-bg-tint text-sm"
        >
          <option value="VIEWER">{tr("role.VIEWER")}</option>
          <option value="EDITOR">{tr("role.EDITOR")}</option>
          <option value="OWNER">{tr("role.OWNER")}</option>
        </select>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              const r = await createInvite({ companyId, role });
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
              <code className="flex-1 min-w-[160px] truncate" title={urlFor(inv.token)}>
                {urlFor(inv.token)}
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
                    const r = await revokeInvite({ companyId, inviteId: inv.id });
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
