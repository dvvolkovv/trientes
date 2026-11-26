/**
 * Правила «если — то» (слайс CO, ТЗ 6.7) — чистые правила без Prisma.
 *
 * Пример задания — «продажа → списание с полки → начисление кэшбэка → задача кладовщику
 * на пополнение» — у нас исполняется **не цепочкой**: списание уже происходит внутри
 * транзакции продажи (у остатка один автор, правило BI), начисление кэшбэка невозможно
 * (кошелька нет — решение BD, оно же в CK), и новым остаётся последнее звено. Поэтому
 * правило вешается на **факт**, а не на звено цепи.
 */
import { AUTOMATION_EVENTS, type AutomationEvent, type EventData } from "@/lib/automation/events";

/** Правил на предприятие — столько, сколько человек перечитает глазами в списке. */
export const MAX_RULES = 20;
/**
 * Срабатываний одного правила в сутки. Считается **до** работы (приём `DAILY_MOVEMENTS`
 * в BC): упёрлось — срабатывание пишется как `SKIPPED` с причиной, а не молчит.
 */
export const RULE_FIRES_PER_DAY = 50;
export const RULE_NAME_MAX = 80;
export const ACTION_TEXT_MAX = 400;
/** Срок задачи правила: «через N дней». Ноль — сегодня, пусто — без срока. */
export const MAX_DUE_DAYS = 90;

/**
 * Причины отказа срабатывания — **известный** список: у `FAILED` в поле лежит сообщение
 * сбоя, и его показывают как есть. Слова есть только у названных причин, остальное —
 * строка, а не код без подписи.
 */
export const RUN_REASONS = [
  "daily_limit",
  "too_many_open",
  "daily_tasks",
  "params_invalid",
  "assignee_gone",
  "recipients_gone",
  "no_recipients",
  "action_unknown",
] as const;
export type RunReason = (typeof RUN_REASONS)[number];

export function isRunReason(value: string): value is RunReason {
  return (RUN_REASONS as readonly string[]).includes(value);
}

export const RULE_ACTIONS = ["CREATE_TASK", "NOTIFY_MEMBER"] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

export function isRuleAction(value: string): value is RuleAction {
  return (RULE_ACTIONS as readonly string[]).includes(value);
}

/**
 * Условия — маленький типизованный набор, по одному смыслу на поле. Какие поля имеет
 * смысл читать у какого триггера, задано здесь, и форма показывает только их: условие,
 * которого триггер не читает, — обманка, а обманка хуже отказа (правило BI).
 */
export const CONDITION_FIELDS = [
  "minTotal",
  "payment",
  "pointId",
  "warehouseId",
  "productId",
  "supplierId",
  "firstMessage",
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const TRIGGER_CONDITIONS: Record<AutomationEvent, readonly ConditionField[]> = {
  SALE_RECORDED: ["minTotal", "payment", "pointId", "warehouseId", "productId"],
  SALE_CANCELLED: ["minTotal", "pointId"],
  STOCK_LOW: ["warehouseId", "productId", "pointId"],
  STOCK_OUT: ["warehouseId", "productId", "pointId"],
  ORDER_RECEIVED: ["supplierId", "warehouseId"],
  CUSTOMER_MESSAGE: ["firstMessage"],
};

export type RuleConditions = {
  minTotal?: number;
  payment?: string;
  pointId?: string;
  warehouseId?: string;
  productId?: string;
  supplierId?: string;
  firstMessage?: boolean;
};

export type TaskActionParams = {
  title: string;
  details?: string | null;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  dueDays?: number | null;
  assigneeId?: string | null;
};

export type NotifyActionParams = {
  text: string;
  /** Кому писать. Пусто — владельцам: безадресное уведомление будить всех не должно. */
  userIds: string[];
};

export type RuleParams = TaskActionParams | NotifyActionParams;

export type RuleRow = {
  id: string;
  trigger: AutomationEvent;
  conditions: RuleConditions;
  action: RuleAction;
  params: RuleParams;
  enabled: boolean;
};

/** Разбор условий из JSONB: неизвестное поле выбрасывается, негодное значение — тоже. */
export function parseConditions(raw: unknown): RuleConditions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: RuleConditions = {};
  if (typeof src.minTotal === "number" && Number.isFinite(src.minTotal) && src.minTotal > 0) {
    out.minTotal = src.minTotal;
  }
  for (const key of ["payment", "pointId", "warehouseId", "productId", "supplierId"] as const) {
    const value = src[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  if (typeof src.firstMessage === "boolean") out.firstMessage = src.firstMessage;
  return out;
}

/**
 * Условия, которые триггер не читает, отбрасываются при разборе тоже: правило могло быть
 * заведено, когда поле имело смысл, а триггер потом сменили. Молча считать забытое
 * условие нельзя — оно беззвучно отсекало бы все события.
 */
export function conditionsFor(trigger: AutomationEvent, conditions: RuleConditions): RuleConditions {
  const allowed = new Set<string>(TRIGGER_CONDITIONS[trigger]);
  const out: RuleConditions = {};
  for (const [key, value] of Object.entries(conditions)) {
    if (allowed.has(key)) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/**
 * Совпало ли событие с правилом. Условия складываются **через И**: человек, поставивший
 * две галочки, ждёт пересечения, а не объединения.
 *
 * Товар у чека ищется и в строках: условие «этот товар» у продажи означает «этот товар в
 * чеке», а не «чек целиком про него».
 */
export function ruleMatches(rule: RuleRow, kind: AutomationEvent, data: EventData): boolean {
  if (!rule.enabled) return false;
  if (rule.trigger !== kind) return false;
  const c = conditionsFor(rule.trigger, rule.conditions);

  if (c.minTotal !== undefined) {
    const total = typeof data.total === "number" ? data.total : null;
    if (total === null || total < c.minTotal) return false;
  }
  if (c.payment !== undefined && data.payment !== c.payment) return false;
  if (c.pointId !== undefined && (data.pointId ?? null) !== c.pointId) return false;
  if (c.warehouseId !== undefined && (data.warehouseId ?? null) !== c.warehouseId) return false;
  if (c.supplierId !== undefined && (data.supplierId ?? null) !== c.supplierId) return false;
  if (c.productId !== undefined) {
    const inLines = (data.lines ?? []).some((l) => l.productId === c.productId);
    if ((data.productId ?? null) !== c.productId && !inLines) return false;
  }
  if (c.firstMessage === true && data.firstMessage !== true) return false;

  return true;
}

/**
 * Подстановка слов события в текст человека. Незнакомая подстановка остаётся как есть:
 * текст принадлежит человеку, и молча съесть его слово хуже, чем показать `{foo}` —
 * увидев это на задаче, он поправит правило сам.
 */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{([a-zA-Z]+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : whole,
  );
}

export type RuleReason =
  | "name_required"
  | "trigger_invalid"
  | "action_invalid"
  | "title_required"
  | "text_required"
  | "text_too_long"
  | "priority_invalid"
  | "due_invalid"
  | "too_many_rules";

export type RuleInput = {
  name: string;
  trigger: string;
  action: string;
  conditions: unknown;
  params: {
    title?: string;
    details?: string | null;
    priority?: string;
    dueDays?: string | number | null;
    assigneeId?: string | null;
    text?: string;
    userIds?: string[];
  };
};

export type RuleValue = {
  name: string;
  trigger: AutomationEvent;
  action: RuleAction;
  conditions: RuleConditions;
  params: RuleParams;
};

const PRIORITIES = new Set(["LOW", "NORMAL", "HIGH", "URGENT"]);

/**
 * Проверка правила. Потолок числа правил считается до записи; имя обязательно — по нему
 * человек узнаёт своё правило в журнале срабатываний, а «Правило 7» ни о чём не говорит.
 */
export function validateRule(
  input: RuleInput,
  ctx: { ruleCount: number },
): { ok: true; value: RuleValue } | { ok: false; reason: RuleReason } {
  const bad = (reason: RuleReason) => ({ ok: false as const, reason });
  if (ctx.ruleCount >= MAX_RULES) return bad("too_many_rules");

  const name = input.name.trim();
  if (name.length < 2 || name.length > RULE_NAME_MAX) return bad("name_required");
  if (!(AUTOMATION_EVENTS as readonly string[]).includes(input.trigger)) return bad("trigger_invalid");
  if (!isRuleAction(input.action)) return bad("action_invalid");
  const trigger = input.trigger as AutomationEvent;
  const conditions = conditionsFor(trigger, parseConditions(input.conditions));

  if (input.action === "CREATE_TASK") {
    const title = (input.params.title ?? "").trim();
    if (title.length < 2) return bad("title_required");
    if (title.length > ACTION_TEXT_MAX) return bad("text_too_long");
    const priority = input.params.priority ?? "NORMAL";
    if (!PRIORITIES.has(priority)) return bad("priority_invalid");
    const details = (input.params.details ?? "").trim() || null;
    if (details && details.length > ACTION_TEXT_MAX) return bad("text_too_long");

    let dueDays: number | null = null;
    const raw = input.params.dueDays;
    if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
      const parsed = Number(String(raw).trim());
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_DUE_DAYS) return bad("due_invalid");
      dueDays = parsed;
    }
    return {
      ok: true,
      value: {
        name,
        trigger,
        action: "CREATE_TASK",
        conditions,
        params: {
          title,
          details,
          priority: priority as TaskActionParams["priority"],
          dueDays,
          assigneeId: input.params.assigneeId?.trim() || null,
        },
      },
    };
  }

  const text = (input.params.text ?? "").trim();
  if (text.length < 2) return bad("text_required");
  if (text.length > ACTION_TEXT_MAX) return bad("text_too_long");
  const userIds = [...new Set((input.params.userIds ?? []).map((u) => u.trim()).filter(Boolean))];
  return { ok: true, value: { name, trigger, action: "NOTIFY_MEMBER", conditions, params: { text, userIds } } };
}

export function parseTaskParams(raw: unknown): TaskActionParams | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const title = typeof src.title === "string" ? src.title : "";
  if (!title.trim()) return null;
  const priority = typeof src.priority === "string" && PRIORITIES.has(src.priority) ? src.priority : "NORMAL";
  return {
    title,
    details: typeof src.details === "string" ? src.details : null,
    priority: priority as TaskActionParams["priority"],
    dueDays: typeof src.dueDays === "number" ? src.dueDays : null,
    assigneeId: typeof src.assigneeId === "string" ? src.assigneeId : null,
  };
}

export function parseNotifyParams(raw: unknown): NotifyActionParams | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const text = typeof src.text === "string" ? src.text : "";
  if (!text.trim()) return null;
  const userIds = Array.isArray(src.userIds) ? src.userIds.filter((u): u is string => typeof u === "string") : [];
  return { text, userIds };
}

/** Срок задачи правила: «через N дней» от сегодняшнего конца дня (тот же приём, что BF). */
export function dueFromDays(days: number | null | undefined, now: Date): Date | null {
  if (days === null || days === undefined) return null;
  const due = new Date(now);
  due.setUTCDate(due.getUTCDate() + days);
  due.setUTCHours(23, 59, 59, 999);
  return due;
}
