/**
 * Исполнитель правил (слайс CO). Зовётся из `emitCompanyEvent` сразу после записи
 * события и **только для событий `SYSTEM`**: событие, рождённое действием правила,
 * правил не запускает — иначе «задача → задача» крутится вечно.
 *
 * Каждое срабатывание оставляет строку (`CompanyRuleRun`): `DONE`, `SKIPPED` с причиной
 * или `FAILED`. Молчаливого «ничего не случилось» нет — без этой строки конструктор
 * правил неотлаживаем, и человек остаётся с вопросом «почему не сработало».
 */
import { prisma } from "@/lib/prisma";
import { DAILY_TASKS, MAX_OPEN_TASKS } from "@/lib/company-tasks/rules";
import { notifyTaskEvent } from "@/lib/company-tasks/notify";
import { notifyRuleRecipients } from "@/lib/automation/notify";
import { eventVars, parseEventData, type AutomationEvent, type EventData } from "@/lib/automation/events";
import {
  RULE_FIRES_PER_DAY,
  dueFromDays,
  parseConditions,
  parseNotifyParams,
  parseTaskParams,
  renderTemplate,
  ruleMatches,
  type RuleAction,
} from "@/lib/automation/rules";

type RunOutcome = { outcome: "DONE" | "SKIPPED" | "FAILED"; reason?: string | null; taskId?: string | null };

function startOfUtcDay(): Date {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

export async function runRulesForEvent(event: {
  id: string;
  companyId: string;
  kind: AutomationEvent;
  data: EventData;
}): Promise<void> {
  // Снятое надзором или удалённое предприятие правил не исполняет: надзор гасит всё.
  const rules = await prisma.companyRule.findMany({
    where: {
      companyId: event.companyId,
      trigger: event.kind,
      enabled: true,
      company: { suspendedAt: null, deletedAt: null },
    },
    select: {
      id: true,
      name: true,
      trigger: true,
      conditions: true,
      action: true,
      params: true,
      enabled: true,
      company: { select: { displayName: true } },
    },
  });
  if (rules.length === 0) return;

  const data = parseEventData(event.data);
  for (const rule of rules) {
    const matches = ruleMatches(
      {
        id: rule.id,
        trigger: rule.trigger as AutomationEvent,
        conditions: parseConditions(rule.conditions),
        action: rule.action as RuleAction,
        params: { text: "", userIds: [] },
        enabled: rule.enabled,
      },
      event.kind,
      data,
    );
    // Несовпавшее правило строки не оставляет: иначе одна продажа писала бы двадцать
    // строк «не про меня», и настоящее срабатывание в них утонуло бы.
    if (!matches) continue;

    let result: RunOutcome;
    try {
      const firedToday = await prisma.companyRuleRun.count({
        where: { ruleId: rule.id, outcome: "DONE", createdAt: { gte: startOfUtcDay() } },
      });
      if (firedToday >= RULE_FIRES_PER_DAY) {
        result = { outcome: "SKIPPED", reason: "daily_limit" };
      } else if (rule.action === "CREATE_TASK") {
        result = await createTaskFromRule({
          companyId: event.companyId,
          companyName: rule.company.displayName,
          ruleId: rule.id,
          params: rule.params,
          data,
        });
      } else if (rule.action === "NOTIFY_MEMBER") {
        result = await notifyFromRule({
          companyId: event.companyId,
          companyName: rule.company.displayName,
          ruleName: rule.name,
          params: rule.params,
          data,
        });
      } else {
        // Действие могло исчезнуть из кода — это отказ с причиной, а не падение.
        result = { outcome: "SKIPPED", reason: "action_unknown" };
      }
    } catch (error) {
      console.error("automation_rule_failed", rule.id, error);
      result = { outcome: "FAILED", reason: String((error as Error)?.message ?? error).slice(0, 200) };
    }

    try {
      await prisma.companyRuleRun.create({
        data: {
          ruleId: rule.id,
          eventId: event.id,
          outcome: result.outcome,
          reason: result.reason ?? null,
          taskId: result.taskId ?? null,
        },
      });
      if (result.outcome === "DONE") {
        await prisma.companyRule.update({
          where: { id: rule.id },
          data: { firedCount: { increment: 1 }, lastFiredAt: new Date() },
        });
      }
    } catch (error) {
      console.error("automation_run_log_failed", rule.id, error);
    }
  }
}

/**
 * Задача от правила. Привязки (товар, склад, точка) берутся **из события**, а не из
 * формы: задача «пополнить» без указания, что именно, бесполезна.
 *
 * Автора у такой задачи нет (`createdById = null`): правило не человек. Следствие
 * честное и названное на экране — принять такую работу может носитель права `tasks:
 * EDIT`, потому что постановщика, которому BF отдаёт приёмку, у неё нет.
 *
 * Потолки задач BF остаются главнее правила: иначе правило обходило бы ограничитель,
 * который человек обойти не может.
 */
async function createTaskFromRule(input: {
  companyId: string;
  companyName: string;
  ruleId: string;
  params: unknown;
  data: EventData;
}): Promise<RunOutcome> {
  const params = parseTaskParams(input.params);
  if (!params) return { outcome: "SKIPPED", reason: "params_invalid" };

  const [openCount, todayCount] = await Promise.all([
    prisma.companyTask.count({ where: { companyId: input.companyId, status: { notIn: ["DONE", "CANCELLED"] } } }),
    prisma.companyTask.count({ where: { companyId: input.companyId, createdAt: { gte: startOfUtcDay() } } }),
  ]);
  if (openCount >= MAX_OPEN_TASKS) return { outcome: "SKIPPED", reason: "too_many_open" };
  if (todayCount >= DAILY_TASKS) return { outcome: "SKIPPED", reason: "daily_tasks" };

  // Исполнитель мог уйти из команды: тогда задача заводится без исполнителя, а причина
  // пишется строкой. Потерять поручение молча нельзя, но и указывать на ушедшего — тоже.
  let assigneeId: string | null = null;
  let reason: string | null = null;
  if (params.assigneeId) {
    const member = await prisma.companyMember.count({
      where: { companyId: input.companyId, userId: params.assigneeId },
    });
    if (member > 0) assigneeId = params.assigneeId;
    else reason = "assignee_gone";
  }

  const vars = eventVars(input.data);
  const task = await prisma.companyTask.create({
    data: {
      companyId: input.companyId,
      title: renderTemplate(params.title, vars).slice(0, 200),
      details: params.details ? renderTemplate(params.details, vars).slice(0, 4000) : null,
      priority: params.priority,
      dueAt: dueFromDays(params.dueDays ?? null, new Date()),
      createdById: null,
      assigneeId,
      assignedAt: assigneeId ? new Date() : null,
      pointId: input.data.pointId ?? null,
      productId: input.data.productId ?? null,
      warehouseId: input.data.warehouseId ?? null,
    },
    select: { id: true, title: true },
  });

  if (assigneeId) {
    await notifyTaskEvent({
      kind: "assigned",
      userIds: [assigneeId],
      companyId: input.companyId,
      companyName: input.companyName,
      taskId: task.id,
      taskTitle: task.title,
    });
  }
  return { outcome: "DONE", reason, taskId: task.id };
}

/**
 * Уведомление от правила. Получатели — названные члены команды; пусто или все ушли —
 * владельцы: безадресное уведомление не должно будить всю команду (прецедент AO, где
 * дело без взявшего молчит).
 */
async function notifyFromRule(input: {
  companyId: string;
  companyName: string;
  ruleName: string;
  params: unknown;
  data: EventData;
}): Promise<RunOutcome> {
  const params = parseNotifyParams(input.params);
  if (!params) return { outcome: "SKIPPED", reason: "params_invalid" };

  let userIds: string[] = [];
  if (params.userIds.length > 0) {
    const members = await prisma.companyMember.findMany({
      where: { companyId: input.companyId, userId: { in: params.userIds } },
      select: { userId: true },
    });
    userIds = members.map((m) => m.userId);
  }
  let reason: string | null = null;
  if (userIds.length === 0) {
    if (params.userIds.length > 0) reason = "recipients_gone";
    const owners = await prisma.companyMember.findMany({
      where: { companyId: input.companyId, role: "OWNER" },
      select: { userId: true },
    });
    userIds = owners.map((o) => o.userId);
  }
  if (userIds.length === 0) return { outcome: "SKIPPED", reason: "no_recipients" };

  await notifyRuleRecipients({
    userIds,
    companyId: input.companyId,
    companyName: input.companyName,
    ruleName: input.ruleName,
    text: renderTemplate(params.text, eventVars(input.data)),
  });
  return { outcome: "DONE", reason };
}
