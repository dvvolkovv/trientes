"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createTask } from "@/app/actions/company-tasks";
import { TASK_PRIORITIES } from "@/lib/company-tasks/rules";

export type TaskOption = { id: string; label: string };

/**
 * Постановка задачи. Форма не предлагает того, что действие всё равно отвергнет:
 * сотруднику участка видны только его точки и склады (прецедент формы склада в BC).
 */
export function TaskCreateForm({
  companyId,
  members,
  points,
  products,
  warehouses,
}: {
  companyId: string;
  members: TaskOption[];
  points: TaskOption[];
  products: TaskOption[];
  warehouses: TaskOption[];
}) {
  const t = useTranslations("cabinetTasks");
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [pointId, setPointId] = useState("");
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const field = "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm";
  const label = "text-[12px] uppercase tracking-[0.14em] text-muted";

  function submit() {
    setError(null);
    start(async () => {
      const res = await createTask(companyId, {
        title,
        details: details || null,
        priority,
        dueDate: dueDate || null,
        assigneeId: assigneeId || null,
        pointId: pointId || null,
        productId: productId || null,
        warehouseId: warehouseId || null,
      });
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setTitle("");
      setDetails("");
      setDueDate("");
      router.refresh();
    });
  }

  return (
    <div className="border border-hairline rounded-lg p-4 space-y-3">
      <h2 className="text-sm font-medium">{t("createHeading")}</h2>

      <label className="block space-y-1">
        <span className={label}>{t("fields.title")}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} maxLength={200} />
      </label>

      <label className="block space-y-1">
        <span className={label}>{t("fields.details")}</span>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} className={`${field} min-h-[80px]`} maxLength={4000} />
      </label>

      <div className="grid md:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className={label}>{t("fields.assignee")}</span>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={field}>
            <option value="">{t("fields.assigneeNone")}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className={label}>{t("fields.priority")}</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className={field}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>{t(`priorities.${p}`)}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          {/* Срок — дата: часового пояса у предприятия в данных нет. */}
          <span className={label}>{t("fields.due")}</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={field} />
        </label>

        <label className="block space-y-1">
          <span className={label}>{t("fields.point")}</span>
          <select value={pointId} onChange={(e) => setPointId(e.target.value)} className={field}>
            <option value="">{t("fields.none")}</option>
            {points.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className={label}>{t("fields.product")}</span>
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className={field}>
            <option value="">{t("fields.none")}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className={label}>{t("fields.warehouse")}</span>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={field}>
            <option value="">{t("fields.none")}</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.label}</option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p className="text-sm text-red-400">
          {/* Код отказа переводится: «не удалось сохранить» заставляет жать кнопку снова. */}
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="h-12 w-full rounded-md bg-accent text-black text-sm font-medium disabled:opacity-50"
      >
        {pending ? t("saving") : t("create")}
      </button>
    </div>
  );
}
