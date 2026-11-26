/**
 * Единственная дверь, через которую рождается событие предприятия (слайс CO).
 *
 * Зовётся **после коммита** того, что событие описывает: откатившаяся продажа факта не
 * оставляет, а оповещение о том, чего не было, хуже молчания. По той же причине вызов
 * ничего не ждёт от правил и доставок — **сбой автоматизации работу не роняет**
 * (прецеденты `ensureCase` в AN и `logCompanyAction` в BE): продажа дороже задачи о ней.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AutomationEvent, EventData, EventSource } from "@/lib/automation/events";
import { runRulesForEvent } from "@/lib/automation/run";
import { deliveryPayload, parseWebhookEvents } from "@/lib/automation/webhooks";

export type EmitInput = {
  companyId: string;
  kind: AutomationEvent;
  subject?: string | null;
  data: EventData;
  actorUserId?: string | null;
  /** `RULE` — следствие действия правила: такое событие правил не запускает. */
  source?: EventSource;
};

export async function emitCompanyEvent(input: EmitInput): Promise<void> {
  try {
    const source: EventSource = input.source ?? "SYSTEM";
    const event = await prisma.companyEvent.create({
      data: {
        companyId: input.companyId,
        kind: input.kind,
        source,
        subject: input.subject ?? null,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
        actorUserId: input.actorUserId ?? null,
      },
      select: { id: true, companyId: true, kind: true, subject: true, createdAt: true },
    });

    if (source === "SYSTEM") {
      await runRulesForEvent({
        id: event.id,
        companyId: input.companyId,
        kind: input.kind,
        data: input.data ?? {},
      });
    }
    await enqueueDeliveries({
      eventId: event.id,
      companyId: input.companyId,
      kind: input.kind,
      subject: event.subject,
      createdAt: event.createdAt,
      data: input.data ?? {},
    });
  } catch (error) {
    console.error("automation_emit_failed", input.companyId, input.kind, error);
  }
}

/**
 * Очередь доставок. Тело складывается **сейчас** и ложится снимком: подпись обязана
 * сойтись у повтора через шесть часов, даже если имя товара с тех пор изменилось.
 *
 * Снятое надзором или удалённое предприятие наружу не шлёт: надзор гасит всё, что
 * смотрит наружу (правило CL о ключах API).
 */
async function enqueueDeliveries(input: {
  eventId: string;
  companyId: string;
  kind: AutomationEvent;
  subject: string | null;
  createdAt: Date;
  data: EventData;
}): Promise<void> {
  const hooks = await prisma.companyWebhook.findMany({
    where: { companyId: input.companyId, enabled: true, company: { suspendedAt: null, deletedAt: null } },
    select: { id: true, events: true },
  });
  if (hooks.length === 0) return;
  const targets = hooks.filter((h) => parseWebhookEvents(h.events).includes(input.kind));
  if (targets.length === 0) return;
  const payload = deliveryPayload(input) as Prisma.InputJsonValue;
  await prisma.webhookDelivery.createMany({
    data: targets.map((h) => ({
      webhookId: h.id,
      eventId: input.eventId,
      kind: input.kind,
      payload,
    })),
  });
}
