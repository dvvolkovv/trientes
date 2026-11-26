/**
 * Чтение для экрана автоматизации (слайс CO): правила, последние события, срабатывания,
 * адреса оповещений и их доставки.
 *
 * Лента событий и журнал срабатываний — это дверь «почему не сработало». Без неё
 * конструктор правил неотлаживаем: человек видит только то, что ничего не произошло.
 */
import { prisma } from "@/lib/prisma";
import { parseEventData, type AutomationEvent, type EventData, type EventSource } from "@/lib/automation/events";
import { parseConditions, parseNotifyParams, parseTaskParams, type RuleAction } from "@/lib/automation/rules";
import { parseWebhookEvents } from "@/lib/automation/webhooks";

/** Событий и срабатываний на экране: это лента, а не архив. */
export const FEED_LIMIT = 20;
const RUNS_LIMIT = 5;

export type RuleView = {
  id: string;
  name: string;
  trigger: AutomationEvent;
  action: RuleAction;
  conditions: ReturnType<typeof parseConditions>;
  taskParams: ReturnType<typeof parseTaskParams>;
  notifyParams: ReturnType<typeof parseNotifyParams>;
  enabled: boolean;
  firedCount: number;
  lastFiredAt: Date | null;
  runs: { id: string; outcome: string; reason: string | null; taskId: string | null; createdAt: Date }[];
};

export async function readRules(companyId: string): Promise<RuleView[]> {
  const rows = await prisma.companyRule.findMany({
    where: { companyId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      trigger: true,
      action: true,
      conditions: true,
      params: true,
      enabled: true,
      firedCount: true,
      lastFiredAt: true,
      runs: {
        orderBy: { createdAt: "desc" },
        take: RUNS_LIMIT,
        select: { id: true, outcome: true, reason: true, taskId: true, createdAt: true },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    trigger: r.trigger as AutomationEvent,
    action: r.action as RuleAction,
    conditions: parseConditions(r.conditions),
    taskParams: r.action === "CREATE_TASK" ? parseTaskParams(r.params) : null,
    notifyParams: r.action === "NOTIFY_MEMBER" ? parseNotifyParams(r.params) : null,
    enabled: r.enabled,
    firedCount: r.firedCount,
    lastFiredAt: r.lastFiredAt,
    runs: r.runs,
  }));
}

export type EventView = {
  id: string;
  kind: AutomationEvent;
  source: EventSource;
  subject: string | null;
  data: EventData;
  createdAt: Date;
};

export async function readEvents(companyId: string, take = FEED_LIMIT): Promise<EventView[]> {
  const rows = await prisma.companyEvent.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, kind: true, source: true, subject: true, data: true, createdAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as AutomationEvent,
    source: r.source as EventSource,
    subject: r.subject,
    data: parseEventData(r.data),
    createdAt: r.createdAt,
  }));
}

export type WebhookView = {
  id: string;
  url: string;
  events: AutomationEvent[];
  enabled: boolean;
  createdAt: Date;
  lastDeliveredAt: Date | null;
  lastFailedAt: Date | null;
  lastError: string | null;
  deliveries: {
    id: string;
    kind: string;
    status: string;
    attempts: number;
    lastStatus: number | null;
    lastError: string | null;
    createdAt: Date;
  }[];
};

export async function readWebhooks(companyId: string): Promise<WebhookView[]> {
  const rows = await prisma.companyWebhook.findMany({
    where: { companyId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      url: true,
      events: true,
      enabled: true,
      createdAt: true,
      lastDeliveredAt: true,
      lastFailedAt: true,
      lastError: true,
      deliveries: {
        orderBy: { createdAt: "desc" },
        take: RUNS_LIMIT,
        select: {
          id: true,
          kind: true,
          status: true,
          attempts: true,
          lastStatus: true,
          lastError: true,
          createdAt: true,
        },
      },
    },
  });
  return rows.map((r) => ({ ...r, events: parseWebhookEvents(r.events) }));
}

/**
 * Кого можно выбрать исполнителем задачи и получателем уведомления: члены команды с
 * именем входа. Чужих здесь нет — правило адресует работу внутрь предприятия.
 */
export async function readRuleTargets(companyId: string) {
  const members = await prisma.companyMember.findMany({
    where: { companyId },
    select: { userId: true, user: { select: { username: true, name: true } } },
  });
  return members.map((m) => ({
    userId: m.userId,
    label: m.user?.username ? `@${m.user.username}` : (m.user?.name ?? m.userId.slice(0, 6)),
  }));
}

/** Точки, склады, товары и поставщики — для условий правила. */
export async function readConditionOptions(companyId: string) {
  const [points, warehouses, offers, suppliers] = await Promise.all([
    prisma.companyPoint.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.warehouse.findMany({
      where: { companyId, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.productOffer.findMany({
      where: { companyId },
      select: { productId: true, product: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.supplier.findMany({
      where: { companyId, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return {
    points: points.map((p) => ({ id: p.id, label: p.name })),
    warehouses: warehouses.map((w) => ({ id: w.id, label: w.name })),
    products: offers.map((o) => ({ id: o.productId, label: o.product.name })),
    suppliers: suppliers.map((s) => ({ id: s.id, label: s.name })),
  };
}
