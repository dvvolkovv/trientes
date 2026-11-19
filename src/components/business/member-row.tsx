"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CompanyRole } from "@prisma/client";
import { updateMemberRole, removeMember } from "@/app/actions/company-members";
import { setMemberTeamRole, setMemberPoints } from "@/app/actions/company-team";

export type TeamRoleOption = { id: string; name: string };

type Props = {
  companyId: string;
  userId: string;
  isSelf: boolean;
  displayLabel: string;
  handle: string | null;
  role: CompanyRole;
  canManage: boolean;
  /// Свои роли предприятия (слайс BE) — выбираются тем же списком, что базовые.
  teamRoles?: TeamRoleOption[];
  teamRoleId?: string | null;
  /// Точки предприятия и участок этого члена: пусто — все точки.
  points?: { id: string; name: string }[];
  memberPointIds?: string[];
};

export function MemberRow({
  companyId,
  userId,
  isSelf,
  displayLabel,
  handle,
  role,
  canManage,
  teamRoles = [],
  teamRoleId = null,
  points = [],
  memberPointIds = [],
}: Props) {
  const t = useTranslations("business.members");
  const ts = useTranslations("cabinetTeam.scope");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [scope, setScope] = useState<string[]>(memberPointIds);

  function changeChoice(value: string) {
    startTransition(async () => {
      const r = value.startsWith("role:")
        ? await setMemberTeamRole({ companyId, userId, roleId: value.slice(5) })
        : await updateMemberRole({ companyId, userId, role: value as CompanyRole });
      if (r.ok) router.refresh();
      else alert(t(`errors.${r.reason}`));
    });
  }

  function saveScope() {
    startTransition(async () => {
      const r = await setMemberPoints({ companyId, userId, pointIds: scope });
      if (r.ok) router.refresh();
      else alert(ts(`errors.${r.reason}`));
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

  const choice = teamRoleId ? `role:${teamRoleId}` : role;
  const roleLabel = teamRoleId ? (teamRoles.find((x) => x.id === teamRoleId)?.name ?? t(`role.${role}`)) : t(`role.${role}`);

  return (
    <div className="border border-hairline rounded-md px-3 py-2.5">
    <div className="flex items-center justify-between gap-3">
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
            value={choice}
            disabled={pending}
            aria-label={t("title")}
            onChange={(e) => changeChoice(e.target.value)}
            className="text-xs px-2 py-1 rounded-md border border-hairline bg-bg-tint disabled:opacity-50"
          >
            <option value="VIEWER">{t("role.VIEWER")}</option>
            <option value="EDITOR">{t("role.EDITOR")}</option>
            <option value="OWNER">{t("role.OWNER")}</option>
            {teamRoles.map((r) => (
              <option key={r.id} value={`role:${r.id}`}>
                {r.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs px-2 py-1 rounded-md bg-bg-tint text-muted">{roleLabel}</span>
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

      {canManage && points.length > 0 && role !== "OWNER" ? (
        <details className="mt-2">
          <summary className="text-xs text-muted cursor-pointer">
            {scope.length === 0 ? ts("all") : ts("some", { count: scope.length })}
          </summary>
          <p className="text-xs text-muted mt-2">{ts("hint")}</p>
          <ul className="mt-2 space-y-1">
            {points.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={scope.includes(p.id)}
                    disabled={pending}
                    onChange={(e) =>
                      setScope((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)))
                    }
                  />
                  <span className="truncate">{p.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={pending}
            onClick={saveScope}
            className="mt-3 h-12 px-4 rounded-md border border-hairline text-sm font-medium hover:border-accent disabled:opacity-50"
          >
            {ts("save")}
          </button>
        </details>
      ) : null}
    </div>
  );
}
