"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CoinCardRole } from "@prisma/client";
import { inviteCardMember } from "@/app/actions/coin-card-members";

export function CardInviteMemberForm({
  cardId,
  canAssignOwner,
}: {
  cardId: string;
  canAssignOwner: boolean;
}) {
  const t = useTranslations("coinCard.team");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<CoinCardRole>("EDITOR");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setSuccess(false);
        start(async () => {
          const r = await inviteCardMember({ cardId, identifier, role });
          if (r.ok) {
            setIdentifier("");
            setSuccess(true);
            router.refresh();
          } else {
            setError(r.reason);
          }
        });
      }}
      className="flex flex-wrap gap-2 items-stretch border border-hairline rounded-md p-3 bg-card-alt"
    >
      <input
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        placeholder={t("identifierPlaceholder")}
        className="flex-1 min-w-[180px] px-3 py-2 rounded-md border border-hairline bg-bg-tint text-sm"
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as CoinCardRole)}
        className="px-3 py-2 rounded-md border border-hairline bg-bg-tint text-sm"
      >
        <option value="VIEWER">{t("role.VIEWER")}</option>
        <option value="EDITOR">{t("role.EDITOR")}</option>
        <option value="ADMIN">{t("role.ADMIN")}</option>
        {canAssignOwner ? <option value="OWNER">{t("role.OWNER")}</option> : null}
      </select>
      <button
        type="submit"
        disabled={pending || identifier.trim().length < 2}
        className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
      >
        {pending ? t("inviting") : t("invite")}
      </button>
      {error ? <p className="basis-full text-red-500 text-xs">{t(`errors.${error}`)}</p> : null}
      {success ? <p className="basis-full text-green-500 text-xs">{t("inviteSuccess")}</p> : null}
    </form>
  );
}
