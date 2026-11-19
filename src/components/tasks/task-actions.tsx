"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { moveTask, updateTask } from "@/app/actions/company-tasks";
import type { TaskStatus } from "@/lib/company-tasks/rules";

/**
 * Переходы задачи. Какие кнопки показывать, решает сервер (`canTransition`) и передаёт
 * список: правило перехода одно, и вторая его копия в браузере разошлась бы с первой.
 */
export function TaskActions({
  companyId,
  taskId,
  status,
  moves,
  members,
  manage,
  assigneeId,
}: {
  companyId: string;
  taskId: string;
  /** Текущий статус: из «на проверке» переход в работу — это возврат, а не взятие. */
  status: TaskStatus;
  moves: TaskStatus[];
  members: { id: string; label: string }[];
  manage: boolean;
  assigneeId: string | null;
}) {
  const t = useTranslations("cabinetTasks");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [assignee, setAssignee] = useState(assigneeId ?? "");
  const [pending, start] = useTransition();

  function move(to: TaskStatus) {
    setError(null);
    start(async () => {
      const res = await moveTask(companyId, taskId, to, to === "CANCELLED" ? reason : null);
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setReason("");
      router.refresh();
    });
  }

  function reassign() {
    setError(null);
    start(async () => {
      const res = await updateTask(companyId, taskId, { assigneeId: assignee || null });
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      router.refresh();
    });
  }

  const cancelling = moves.includes("CANCELLED");
  const field = "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm";

  return (
    <div className="space-y-3">
      {moves.filter((m) => m !== "CANCELLED").map((to) => (
        <button
          key={to}
          type="button"
          onClick={() => move(to)}
          disabled={pending}
          className="h-12 w-full rounded-md bg-accent text-black text-sm font-medium disabled:opacity-50"
        >
          {/* Живой прогон 19 ноября поймал подпись-ложь: у задачи «на проверке» кнопка
              перехода в работу означает «вернуть исполнителю», а не «взять». */}
          {to === "IN_PROGRESS" && status === "ON_REVIEW" ? t("moves.RETURN") : t(`moves.${to}`)}
        </button>
      ))}

      {cancelling ? (
        <div className="space-y-2 border border-hairline rounded-md p-3">
          <span className="text-[12px] uppercase tracking-[0.14em] text-muted">{t("cancelReason")}</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
          <button
            type="button"
            onClick={() => move("CANCELLED")}
            disabled={pending}
            className="h-12 w-full rounded-md border border-hairline text-sm disabled:opacity-50"
          >
            {t("moves.CANCELLED")}
          </button>
        </div>
      ) : null}

      {/* У закрытой задачи переназначения нет: действие его отвергнет (`task_closed`), а
          форма-обманка хуже отказа (правило BE). Поймано живым прогоном 19 ноября. */}
      {manage && moves.length > 0 ? (
        <div className="space-y-2 border border-hairline rounded-md p-3">
          <span className="text-[12px] uppercase tracking-[0.14em] text-muted">{t("fields.assignee")}</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={field}>
            <option value="">{t("fields.assigneeNone")}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={reassign}
            disabled={pending}
            className="h-12 w-full rounded-md border border-hairline text-sm disabled:opacity-50"
          >
            {t("reassign")}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-red-400">{t.has(`errors.${error}`) ? t(`errors.${error}`) : error}</p>
      ) : null}
    </div>
  );
}
