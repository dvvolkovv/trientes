"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CompanyRole } from "@prisma/client";
import { updateMemberRole, removeMember } from "@/app/actions/company-members";

type Props = {
  companyId: string;
  userId: string;
  isSelf: boolean;
  displayLabel: string;
  handle: string | null;
  role: CompanyRole;
  canManage: boolean;
};

export function MemberRow({ companyId, userId, isSelf, displayLabel, handle, role, canManage }: Props) {
  const t = useTranslations("business.members");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function changeRole(next: CompanyRole) {
    if (next === role) return;
    startTransition(async () => {
      const r = await updateMemberRole({ companyId, userId, role: next });
      if (r.ok) router.refresh();
      else alert(t(`errors.${r.reason}`));
    });
  }

  function remove() {
    if (!confirm(t("confirmRemove", { name: displayLabel }))) return;
    startTransition(async () => {
      const r = await removeMember({ companyId, userId });
      if (r.ok) router.refresh();
      else alert(t(`errors.${r.reason}`));
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 border border-hairline rounded-md px-3 py-2.5">
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
            value={role}
            disabled={pending}
            onChange={(e) => changeRole(e.target.value as CompanyRole)}
            className="text-xs px-2 py-1 rounded-md border border-hairline bg-bg-tint disabled:opacity-50"
          >
            <option value="VIEWER">{t("role.VIEWER")}</option>
            <option value="EDITOR">{t("role.EDITOR")}</option>
            <option value="OWNER">{t("role.OWNER")}</option>
          </select>
        ) : (
          <span className="text-xs px-2 py-1 rounded-md bg-bg-tint text-muted">{t(`role.${role}`)}</span>
        )}
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
  );
}
