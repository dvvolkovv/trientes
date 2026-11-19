"use client";

/**
 * Конструктор ролей предприятия: матрица «раздел × уровень» и четыре шаблона из ТЗ 6.6.
 * Шаблон только заполняет галочки — дальше они правятся руками, и сохранённая роль от
 * шаблона больше не зависит (прецедент AS: четыре должности сотрудника платформы).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { TEAM_SECTIONS, ROLE_TEMPLATES, type TeamSection } from "@/lib/company-team/permissions";
import { saveTeamRole, deleteTeamRole } from "@/app/actions/company-team";

export type TeamRoleItem = {
  id: string;
  name: string;
  permissions: Record<string, string>;
  members: number;
};

type Draft = { name: string; permissions: Record<string, string> };

const EMPTY: Draft = { name: "", permissions: {} };

export function TeamRoles({ companyId, roles }: { companyId: string; roles: TeamRoleItem[] }) {
  const t = useTranslations("cabinetTeam.roles");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  function startNew() {
    setEditingId(null);
    setDraft(EMPTY);
    setError(null);
  }

  function startEdit(role: TeamRoleItem) {
    setEditingId(role.id);
    setDraft({ name: role.name, permissions: { ...role.permissions } });
    setError(null);
  }

  function applyTemplate(key: string) {
    const template = ROLE_TEMPLATES.find((x) => x.key === key);
    if (!template) return;
    setDraft((d) => ({
      // Имя подставляем только пустому: правя живую роль, владелец меняет права,
      // а не переименовывает её за свой счёт.
      name: d.name || t(`templates.${key}`),
      permissions: { ...(template.permissions as Record<string, string>) },
    }));
  }

  function setLevel(section: TeamSection, level: string) {
    setDraft((d) => {
      const next = { ...d.permissions };
      if (level === "NONE") delete next[section];
      else next[section] = level;
      return { ...d, permissions: next };
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await saveTeamRole({ companyId, roleId: editingId, name: draft.name, permissions: draft.permissions });
      if (r.ok) {
        startNew();
        router.refresh();
      } else {
        setError(r.reason);
      }
    });
  }

  function remove(role: TeamRoleItem) {
    if (!confirm(t("confirmDelete", { name: role.name, members: role.members }))) return;
    startTransition(async () => {
      const r = await deleteTeamRole({ companyId, roleId: role.id });
      if (r.ok) {
        if (editingId === role.id) startNew();
        router.refresh();
      } else {
        setError(r.reason);
      }
    });
  }

  return (
    <section className="mt-10">
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h2>
      <p className="text-sm text-muted mb-4">{t("subtitle")}</p>

      {roles.length === 0 ? (
        <p className="text-sm text-muted mb-4">{t("empty")}</p>
      ) : (
        <ul className="space-y-2 mb-6">
          {roles.map((role) => (
            <li
              key={role.id}
              className="border border-hairline rounded-md px-3 py-2.5 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{role.name}</div>
                <div className="text-xs text-muted truncate">
                  {TEAM_SECTIONS.filter((s) => role.permissions[s]).map((s) => `${t(`sections.${s}`)}: ${t(`levels.${role.permissions[s]}`)}`).join(" · ") ||
                    t("levels.NONE")}
                </div>
                <div className="text-xs text-muted">{t("inUse", { count: role.members })}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startEdit(role)}
                  className="text-xs px-2 py-1 rounded-md border border-hairline hover:border-accent disabled:opacity-50"
                >
                  {t("edit")}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(role)}
                  className="text-xs px-2 py-1 rounded-md border border-hairline text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                >
                  {t("delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="border border-hairline rounded-lg p-4">
        <div className="text-sm font-medium mb-3">{editingId ? t("editTitle") : t("newTitle")}</div>

        <label className="block text-xs text-muted mb-1" htmlFor="team-role-name">
          {t("name")}
        </label>
        <input
          id="team-role-name"
          value={draft.name}
          disabled={pending}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder={t("namePlaceholder")}
          className="w-full h-12 px-3 rounded-md border border-hairline bg-bg-tint mb-4"
        />

        <div className="text-xs text-muted mb-2">{t("template")}</div>
        <div className="flex flex-wrap gap-2 mb-5">
          {ROLE_TEMPLATES.map((x) => (
            <button
              key={x.key}
              type="button"
              disabled={pending}
              onClick={() => applyTemplate(x.key)}
              className="text-xs px-3 h-9 rounded-md border border-hairline hover:border-accent disabled:opacity-50"
            >
              {t(`templates.${x.key}`)}
            </button>
          ))}
        </div>

        <div className="space-y-2 mb-5">
          {TEAM_SECTIONS.map((section) => (
            <div key={section} className="flex items-center justify-between gap-3">
              <span className="text-sm">{t(`sections.${section}`)}</span>
              <select
                value={draft.permissions[section] ?? "NONE"}
                disabled={pending}
                onChange={(e) => setLevel(section, e.target.value)}
                aria-label={t(`sections.${section}`)}
                className="text-sm h-10 px-2 rounded-md border border-hairline bg-bg-tint disabled:opacity-50"
              >
                <option value="NONE">{t("levels.NONE")}</option>
                <option value="VIEW">{t("levels.VIEW")}</option>
                <option value="EDIT">{t("levels.EDIT")}</option>
              </select>
            </div>
          ))}
        </div>

        {error ? <p className="text-sm text-red-500 mb-3">{t(`errors.${error}`)}</p> : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="h-12 px-4 rounded-md bg-accent text-black font-medium disabled:opacity-50"
          >
            {t("save")}
          </button>
          {editingId ? (
            <button
              type="button"
              disabled={pending}
              onClick={startNew}
              className="h-12 px-4 rounded-md border border-hairline disabled:opacity-50"
            >
              {t("cancel")}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
