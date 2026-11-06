"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CoinCardRole, CoinCardSection } from "@prisma/client";
import { EDITABLE_SECTIONS } from "@/lib/coin-card-form-spec";
import { updateCardMember, removeCardMember } from "@/app/actions/coin-card-members";

export function CardMemberRow({
  cardId,
  userId,
  isSelf,
  displayLabel,
  handle,
  role,
  sections,
  isSigner,
  canManage,
  canManageSigners,
}: {
  cardId: string;
  userId: string;
  isSelf: boolean;
  displayLabel: string;
  handle: string | null;
  role: CoinCardRole;
  sections: CoinCardSection[];
  isSigner: boolean;
  canManage: boolean;
  canManageSigners: boolean;
}) {
  const t = useTranslations("coinCard.team");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draftRole, setDraftRole] = useState<CoinCardRole>(role);
  const [draftSections, setDraftSections] = useState<CoinCardSection[]>(sections);
  const [draftSigner, setDraftSigner] = useState(isSigner);

  const dirty =
    draftRole !== role ||
    draftSigner !== isSigner ||
    draftSections.join(",") !== sections.join(",");

  function save() {
    setError(null);
    start(async () => {
      const r = await updateCardMember({
        cardId,
        userId,
        role: draftRole,
        sections: draftSections,
        isSigner: draftSigner,
      });
      if (r.ok) router.refresh();
      else setError(r.reason);
    });
  }

  function remove() {
    if (!confirm(t("confirmRemove", { name: displayLabel }))) return;
    setError(null);
    start(async () => {
      const r = await removeCardMember({ cardId, userId });
      if (r.ok) router.refresh();
      else setError(r.reason);
    });
  }

  return (
    <div className="border border-hairline rounded-md px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium truncate">
            {displayLabel}
            {isSelf ? <span className="text-xs text-muted ml-2">{t("you")}</span> : null}
          </div>
          {handle ? <div className="text-xs text-muted truncate">{handle}</div> : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canManage ? (
            <select
              value={draftRole}
              disabled={pending}
              onChange={(e) => setDraftRole(e.target.value as CoinCardRole)}
              className="text-xs px-2 py-1 rounded-md border border-hairline bg-bg-tint"
            >
              <option value="VIEWER">{t("role.VIEWER")}</option>
              <option value="EDITOR">{t("role.EDITOR")}</option>
              <option value="ADMIN">{t("role.ADMIN")}</option>
              <option value="OWNER">{t("role.OWNER")}</option>
            </select>
          ) : (
            <span className="text-xs px-2 py-1 rounded-md bg-bg-tint text-muted">
              {t(`role.${role}`)}
            </span>
          )}
          {canManageSigners ? (
            <label className="text-xs flex items-center gap-1">
              <input
                type="checkbox"
                checked={draftSigner}
                disabled={pending}
                onChange={(e) => setDraftSigner(e.target.checked)}
              />
              {t("signer")}
            </label>
          ) : isSigner ? (
            <span className="text-xs text-accent">{t("signer")}</span>
          ) : null}
          {canManage ? (
            <button
              type="button"
              disabled={pending}
              onClick={remove}
              className="text-xs px-2 py-1 rounded-md border border-hairline text-red-500 hover:bg-red-500/10 disabled:opacity-50"
            >
              {t("remove")}
            </button>
          ) : null}
        </div>
      </div>

      {canManage && draftRole === "EDITOR" ? (
        <div className="flex flex-wrap gap-2">
          {EDITABLE_SECTIONS.map((s) => (
            <label key={s} className="text-[11px] flex items-center gap-1">
              <input
                type="checkbox"
                checked={draftSections.includes(s as CoinCardSection)}
                disabled={pending}
                onChange={(e) =>
                  setDraftSections((cur) =>
                    e.target.checked
                      ? [...cur, s as CoinCardSection]
                      : cur.filter((x) => x !== s),
                  )
                }
              />
              {t(`section.${s}`)}
            </label>
          ))}
        </div>
      ) : null}

      {dirty && canManage ? (
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground font-medium disabled:opacity-50"
        >
          {pending ? t("saving") : t("saveMember")}
        </button>
      ) : null}
      {error ? <p className="text-red-500 text-xs">{t(`errors.${error}`)}</p> : null}
    </div>
  );
}
