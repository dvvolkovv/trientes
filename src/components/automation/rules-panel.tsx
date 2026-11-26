"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { deleteRule, saveRule, setRuleEnabled } from "@/app/actions/automation";
import { ADMIN_BUTTON, ADMIN_BUTTON_DANGER, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";
import { AUTOMATION_EVENTS, EVENT_VARS, type AutomationEvent } from "@/lib/automation/events";
import {
  MAX_DUE_DAYS,
  MAX_RULES,
  RULE_ACTIONS,
  TRIGGER_CONDITIONS,
  isRunReason,
  type ConditionField,
  type RuleAction,
} from "@/lib/automation/rules";

export type RuleOption = { id: string; label: string };

export type RulePanelRow = {
  id: string;
  name: string;
  trigger: AutomationEvent;
  action: RuleAction;
  conditions: Record<string, unknown>;
  task: { title: string; details: string | null; priority: string; dueDays: number | null; assigneeId: string | null } | null;
  notify: { text: string; userIds: string[] } | null;
  enabled: boolean;
  firedCount: number;
  lastFiredAt: string | null;
  runs: { id: string; outcome: string; reason: string | null; createdAt: string }[];
};

type Form = {
  id: string | null;
  name: string;
  trigger: AutomationEvent;
  action: RuleAction;
  conditions: Record<string, string>;
  title: string;
  details: string;
  priority: string;
  dueDays: string;
  assigneeId: string;
  text: string;
  userIds: string[];
};

const EMPTY: Form = {
  id: null,
  name: "",
  trigger: "SALE_RECORDED",
  action: "CREATE_TASK",
  conditions: {},
  title: "",
  details: "",
  priority: "NORMAL",
  dueDays: "",
  assigneeId: "",
  text: "",
  userIds: [],
};

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

/**
 * Конструктор правил «если — то» (слайс CO, ТЗ 6.7).
 *
 * Условия показываются **только те, которые триггер читает** (`TRIGGER_CONDITIONS`):
 * условие, которого триггер не читает, — обманка, а обманка хуже отказа (правило BI).
 * Доступные подстановки перечислены у поля: человек не обязан помнить, что у события
 * «кончился товар» нет номера чека.
 */
export function RulesPanel({
  companyId,
  rules,
  options,
  members,
  canEdit,
  locale,
}: {
  companyId: string;
  rules: RulePanelRow[];
  options: { points: RuleOption[]; warehouses: RuleOption[]; products: RuleOption[]; suppliers: RuleOption[] };
  members: RuleOption[];
  canEdit: boolean;
  locale: string;
}) {
  const t = useTranslations("cabinetAutomation");
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const field = "min-h-11 w-full rounded-[12px] border border-hairline bg-card px-3 py-2 text-[14px]";
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

  function openNew() {
    setError(null);
    setForm({ ...EMPTY });
  }

  function openEdit(row: RulePanelRow) {
    setError(null);
    setForm({
      id: row.id,
      name: row.name,
      trigger: row.trigger,
      action: row.action,
      conditions: Object.fromEntries(
        Object.entries(row.conditions).map(([k, v]) => [k, v === true ? "true" : String(v ?? "")]),
      ),
      title: row.task?.title ?? "",
      details: row.task?.details ?? "",
      priority: row.task?.priority ?? "NORMAL",
      dueDays: row.task?.dueDays === null || row.task?.dueDays === undefined ? "" : String(row.task.dueDays),
      assigneeId: row.task?.assigneeId ?? "",
      text: row.notify?.text ?? "",
      userIds: row.notify?.userIds ?? [],
    });
  }

  function submit() {
    if (!form) return;
    setError(null);
    const conditions: Record<string, unknown> = {};
    for (const key of TRIGGER_CONDITIONS[form.trigger]) {
      const raw = form.conditions[key];
      if (!raw) continue;
      if (key === "minTotal") {
        const value = Number(raw.replace(",", "."));
        if (Number.isFinite(value) && value > 0) conditions.minTotal = value;
      } else if (key === "firstMessage") {
        conditions.firstMessage = raw === "true";
      } else {
        conditions[key] = raw;
      }
    }
    start(async () => {
      const r = await saveRule(companyId, form.id, {
        name: form.name,
        trigger: form.trigger,
        action: form.action,
        conditions,
        params:
          form.action === "CREATE_TASK"
            ? {
                title: form.title,
                details: form.details,
                priority: form.priority,
                dueDays: form.dueDays,
                assigneeId: form.assigneeId || null,
              }
            : { text: form.text, userIds: form.userIds },
      });
      if (r.ok) {
        setForm(null);
        router.refresh();
      } else {
        setError(t(`error.${r.reason}` as never));
      }
    });
  }

  function toggle(row: RulePanelRow) {
    setError(null);
    start(async () => {
      const r = await setRuleEnabled(companyId, row.id, !row.enabled);
      if (r.ok) router.refresh();
      else setError(t(`error.${r.reason}` as never));
    });
  }

  function remove(id: string) {
    setError(null);
    start(async () => {
      const r = await deleteRule(companyId, id);
      if (r.ok) {
        setRemoving(null);
        router.refresh();
      } else {
        setError(t(`error.${r.reason}` as never));
      }
    });
  }

  function optionsFor(key: ConditionField): RuleOption[] {
    if (key === "pointId") return options.points;
    if (key === "warehouseId") return options.warehouses;
    if (key === "productId") return options.products;
    if (key === "supplierId") return options.suppliers;
    return [];
  }

  return (
    <section className="mt-8">
      <h2 className="mb-2 text-[12px] uppercase tracking-[0.2em] text-muted">{t("rules.heading")}</h2>
      <p className="mb-3 text-[12.5px] leading-snug text-muted">{t("rules.hint")}</p>
      {/* Договор «один шаг» сказан на экране, а не спрятан в коде: правило отвечает на
          факт, а следствие его собственного действия правил уже не запускает. */}
      <p className="mb-4 rounded-[12px] border border-hairline bg-card p-3 text-[12px] leading-snug text-muted">
        {t("rules.oneStep")}
      </p>

      {rules.length === 0 ? <p className="mb-4 text-[13px] text-muted">{t("rules.empty")}</p> : null}

      <ul className="mb-4 flex flex-col gap-2">
        {rules.map((row) => (
          <li key={row.id} className="rounded-[14px] border border-hairline bg-card p-3">
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1 break-words text-[14px] font-semibold">{row.name}</span>
              <span
                className={`shrink-0 rounded-[8px] border px-2 py-0.5 text-[11px] ${
                  row.enabled ? "border-up/50 text-up" : "border-hairline text-muted"
                }`}
              >
                {row.enabled ? t("rules.enabled") : t("rules.disabled")}
              </span>
            </div>
            <p className="mt-1 text-[12.5px] leading-snug text-muted">
              {t("rules.sentence", {
                trigger: t(`trigger.${row.trigger}` as never),
                action: t(`action.${row.action}` as never),
              })}
            </p>
            <p className="mt-1 text-[11.5px] leading-snug text-muted">
              {t("rules.fired", { count: row.firedCount })}
              {" · "}
              {row.lastFiredAt ? t("rules.lastFired", { at: when(row.lastFiredAt) }) : t("rules.never")}
            </p>

            {row.runs.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {row.runs.map((run) => (
                  <li key={run.id} className="text-[11.5px] leading-snug text-muted">
                    {when(run.createdAt)} · {t(`run.${run.outcome}` as never)}
                    {/* У `FAILED` в причине лежит сообщение сбоя, а не код: показываем
                        как есть — код без подписи на экране это дефект (правило BF). */}
                    {run.reason ? ` · ${isRunReason(run.reason) ? t(`runReason.${run.reason}` as never) : run.reason}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}

            {canEdit ? (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button className={ADMIN_BUTTON_SECONDARY} disabled={pending} onClick={() => openEdit(row)}>
                  {t("rules.edit")}
                </button>
                <button className={ADMIN_BUTTON_SECONDARY} disabled={pending} onClick={() => toggle(row)}>
                  {row.enabled ? t("rules.disable") : t("rules.enable")}
                </button>
                {removing === row.id ? (
                  <button className={ADMIN_BUTTON_DANGER} disabled={pending} onClick={() => remove(row.id)}>
                    {t("rules.deleteConfirm")}
                  </button>
                ) : (
                  <button className={ADMIN_BUTTON_DANGER} disabled={pending} onClick={() => setRemoving(row.id)}>
                    {t("rules.delete")}
                  </button>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {!canEdit ? (
        <p className="rounded-[12px] border border-hairline bg-card p-3 text-[12.5px] leading-snug text-muted">
          {t("rules.readOnly")}
        </p>
      ) : form ? (
        <div className="rounded-[14px] border border-accent bg-card p-3">
          <label className="block text-[12px] text-muted" htmlFor="rule-name">
            {t("builder.name")}
          </label>
          <input
            id="rule-name"
            className={`${field} mt-1`}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t("builder.namePlaceholder")}
          />

          <p className="mt-3 text-[12px] text-muted">{t("builder.trigger")}</p>
          <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {AUTOMATION_EVENTS.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setForm({ ...form, trigger: kind, conditions: {} })}
                className={`min-h-11 rounded-[12px] border px-3 py-2 text-left text-[13px] ${
                  form.trigger === kind ? "border-accent bg-accent/10" : "border-hairline"
                }`}
              >
                {t(`trigger.${kind}` as never)}
              </button>
            ))}
          </div>

          {TRIGGER_CONDITIONS[form.trigger].length > 0 ? (
            <>
              <p className="mt-3 text-[12px] text-muted">{t("builder.conditions")}</p>
              <div className="mt-1 flex flex-col gap-2">
                {TRIGGER_CONDITIONS[form.trigger].map((key) => {
                  const list = optionsFor(key);
                  const value = form.conditions[key] ?? "";
                  const set = (next: string) =>
                    setForm({ ...form, conditions: { ...form.conditions, [key]: next } });
                  return (
                    <div key={key}>
                      <label className="block text-[11.5px] text-muted" htmlFor={`cond-${key}`}>
                        {t(`field.${key}` as never)}
                      </label>
                      {key === "minTotal" ? (
                        <input
                          id={`cond-${key}`}
                          className={`${field} mt-1`}
                          inputMode="decimal"
                          value={value}
                          onChange={(e) => set(e.target.value)}
                          placeholder={t("builder.anyValue")}
                        />
                      ) : key === "firstMessage" ? (
                        <select
                          id={`cond-${key}`}
                          className={`${field} mt-1`}
                          value={value}
                          onChange={(e) => set(e.target.value)}
                        >
                          <option value="">{t("builder.any")}</option>
                          <option value="true">{t("field.firstMessageOnly")}</option>
                        </select>
                      ) : key === "payment" ? (
                        <select
                          id={`cond-${key}`}
                          className={`${field} mt-1`}
                          value={value}
                          onChange={(e) => set(e.target.value)}
                        >
                          <option value="">{t("builder.any")}</option>
                          {["CASH", "CARD", "TRANSFER", "CRYPTO", "OTHER"].map((p) => (
                            <option key={p} value={p}>
                              {t(`payment.${p}` as never)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <select
                          id={`cond-${key}`}
                          className={`${field} mt-1`}
                          value={value}
                          onChange={(e) => set(e.target.value)}
                        >
                          <option value="">{t("builder.any")}</option>
                          {list.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}

          <p className="mt-3 text-[12px] text-muted">{t("builder.action")}</p>
          <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {RULE_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => setForm({ ...form, action })}
                className={`min-h-11 rounded-[12px] border px-3 py-2 text-left text-[13px] ${
                  form.action === action ? "border-accent bg-accent/10" : "border-hairline"
                }`}
              >
                {t(`action.${action}` as never)}
              </button>
            ))}
          </div>

          <p className="mt-2 text-[11.5px] leading-snug text-muted">
            {t("builder.vars", { list: EVENT_VARS[form.trigger].map((v) => `{${v}}`).join(" ") })}
          </p>

          {form.action === "CREATE_TASK" ? (
            <div className="mt-3 flex flex-col gap-2">
              <div>
                <label className="block text-[11.5px] text-muted" htmlFor="rule-title">
                  {t("task.title")}
                </label>
                <input
                  id="rule-title"
                  className={`${field} mt-1`}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder={t("task.titlePlaceholder")}
                />
              </div>
              <div>
                <label className="block text-[11.5px] text-muted" htmlFor="rule-details">
                  {t("task.details")}
                </label>
                <textarea
                  id="rule-details"
                  className={`${field} mt-1`}
                  rows={2}
                  value={form.details}
                  onChange={(e) => setForm({ ...form, details: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-[11.5px] text-muted" htmlFor="rule-priority">
                  {t("task.priority")}
                </label>
                <select
                  id="rule-priority"
                  className={`${field} mt-1`}
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {t(`priority.${p}` as never)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11.5px] text-muted" htmlFor="rule-due">
                  {t("task.dueDays", { max: MAX_DUE_DAYS })}
                </label>
                <input
                  id="rule-due"
                  className={`${field} mt-1`}
                  inputMode="numeric"
                  value={form.dueDays}
                  onChange={(e) => setForm({ ...form, dueDays: e.target.value })}
                  placeholder={t("task.dueEmpty")}
                />
              </div>
              <div>
                <label className="block text-[11.5px] text-muted" htmlFor="rule-assignee">
                  {t("task.assignee")}
                </label>
                <select
                  id="rule-assignee"
                  className={`${field} mt-1`}
                  value={form.assigneeId}
                  onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
                >
                  <option value="">{t("task.unassigned")}</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[11.5px] leading-snug text-muted">{t("task.noAuthorNote")}</p>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              <div>
                <label className="block text-[11.5px] text-muted" htmlFor="rule-text">
                  {t("notify.text")}
                </label>
                <textarea
                  id="rule-text"
                  className={`${field} mt-1`}
                  rows={2}
                  value={form.text}
                  onChange={(e) => setForm({ ...form, text: e.target.value })}
                  placeholder={t("notify.textPlaceholder")}
                />
              </div>
              <p className="text-[11.5px] text-muted">{t("notify.recipients")}</p>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => {
                  const on = form.userIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          userIds: on ? form.userIds.filter((u) => u !== m.id) : [...form.userIds, m.id],
                        })
                      }
                      className={`min-h-11 rounded-[12px] border px-3 text-[13px] ${
                        on ? "border-accent bg-accent/10" : "border-hairline"
                      }`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11.5px] leading-snug text-muted">{t("notify.ownersFallback")}</p>
            </div>
          )}

          {error ? <p className="mt-2 text-[12.5px] text-down">{error}</p> : null}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button className={ADMIN_BUTTON} disabled={pending} onClick={submit}>
              {t("builder.save")}
            </button>
            <button className={ADMIN_BUTTON_SECONDARY} disabled={pending} onClick={() => setForm(null)}>
              {t("builder.cancel")}
            </button>
          </div>
        </div>
      ) : rules.length >= MAX_RULES ? (
        <p className="rounded-[12px] border border-hairline bg-card p-3 text-[12.5px] leading-snug text-muted">
          {t("error.too_many_rules")}
        </p>
      ) : (
        <button className={ADMIN_BUTTON} disabled={pending} onClick={openNew}>
          {t("rules.add")}
        </button>
      )}

      {error && !form ? <p className="mt-2 text-[12.5px] text-down">{error}</p> : null}
    </section>
  );
}
