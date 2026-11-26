/**
 * Прогон доставки исходящих оповещений (слайс CO). Живёт в воркере: доставка — работа с
 * повторами по часам, а не часть отрисовки страницы.
 *
 * Имя узла **разрешается перед каждой отправкой** и проверяется на частные диапазоны:
 * адрес, прошедший проверку формы при заведении, завтра может смотреть на 127.0.0.1, а
 * там у нас Postgres, Redis и pm2. Это и есть защита от подмены DNS.
 */
import { lookup } from "node:dns/promises";
import { prisma } from "@/lib/prisma";
import { automationKeyConfigured, openWebhookSecret } from "@/lib/automation/secret";
import {
  DELIVERIES_PER_SWEEP,
  DELIVERY_TIMEOUT_MS,
  RETENTION_DAYS,
  deliveryVerdict,
  isPrivateAddress,
  nextAttemptAt,
  signPayload,
} from "@/lib/automation/webhooks";

export type WebhookSweepStats = {
  taken: number;
  delivered: number;
  retried: number;
  dropped: number;
  skipped: number;
  prunedEvents: number;
  prunedDeliveries: number;
  reason?: string;
};

/** Разрешение имени: смотрит ли адрес в нашу собственную сеть. */
async function resolvesPrivate(hostname: string): Promise<boolean> {
  try {
    const addresses = await lookup(hostname, { all: true });
    if (addresses.length === 0) return true;
    return addresses.some((a) => isPrivateAddress(a.address));
  } catch {
    // Имя не разрешилось — это сбой связи, а не частный адрес: пусть решает повтор.
    return false;
  }
}

export async function runWebhookSweep(now = new Date()): Promise<WebhookSweepStats> {
  const empty: WebhookSweepStats = {
    taken: 0,
    delivered: 0,
    retried: 0,
    dropped: 0,
    skipped: 0,
    prunedEvents: 0,
    prunedDeliveries: 0,
  };
  // Нет ключа приложения — доставки **не трогаем вовсе**: подписаться нечем, а сжигать
  // попытки за нашу же недонастройку нельзя (ход мысли `no_ledger` в BL).
  if (!automationKeyConfigured()) return { ...empty, reason: "no_secret_key" };

  const rows = await prisma.webhookDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take: DELIVERIES_PER_SWEEP,
    select: {
      id: true,
      kind: true,
      payload: true,
      attempts: true,
      webhook: {
        select: { id: true, url: true, secretSealed: true, enabled: true, companyId: true },
      },
    },
  });

  const stats = { ...empty, taken: rows.length };
  for (const row of rows) {
    const hook = row.webhook;
    if (!hook.enabled) {
      // Выключенный адрес очередь не держит: человек выключил его сознательно.
      await prisma.webhookDelivery.update({
        where: { id: row.id },
        data: { status: "FAILED", lastError: "webhook_disabled" },
      });
      stats.skipped += 1;
      continue;
    }

    const body = JSON.stringify(row.payload);
    let status: number | null = null;
    let error: string | null = null;

    try {
      const url = new URL(hook.url);
      if (await resolvesPrivate(url.hostname)) {
        await prisma.webhookDelivery.update({
          where: { id: row.id },
          data: { status: "FAILED", lastError: "url_private" },
        });
        await prisma.companyWebhook.update({
          where: { id: hook.id },
          data: { enabled: false, lastFailedAt: now, lastError: "url_private" },
        });
        stats.dropped += 1;
        continue;
      }
      const secret = openWebhookSecret(hook.secretSealed);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "user-agent": "trientes-webhook/1.0",
          "x-trientes-event": row.kind,
          "x-trientes-signature": signPayload(body, secret, now.getTime()),
        },
        body,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      status = response.status;
      // Тело ответа не читаем и не храним: чужой сервер вправе отдать мегабайт, а нам
      // нужен только код.
      void response.body?.cancel();
    } catch (err) {
      error = String((err as Error)?.message ?? err).slice(0, 200);
    }

    const verdict = deliveryVerdict(status);
    const attempts = row.attempts + 1;
    if (verdict === "delivered") {
      await prisma.webhookDelivery.update({
        where: { id: row.id },
        data: { status: "DELIVERED", attempts, lastStatus: status, lastError: null, deliveredAt: new Date() },
      });
      await prisma.companyWebhook.update({
        where: { id: hook.id },
        data: { lastDeliveredAt: new Date(), lastError: null },
      });
      stats.delivered += 1;
      continue;
    }

    const next = verdict === "retry" ? nextAttemptAt(attempts, now) : null;
    await prisma.webhookDelivery.update({
      where: { id: row.id },
      data: {
        status: next ? "PENDING" : "FAILED",
        attempts,
        lastStatus: status,
        lastError: error ?? (status === null ? "no_response" : `http ${status}`),
        // У отказавшей навсегда строки штамп остаётся прежним по смыслу: её больше не
        // берут по статусу, а не по времени.
        nextAttemptAt: next ?? now,
      },
    });
    await prisma.companyWebhook.update({
      where: { id: hook.id },
      data: { lastFailedAt: new Date(), lastError: error ?? `http ${status}` },
    });
    if (next) stats.retried += 1;
    else stats.dropped += 1;
  }

  // Чистка: лента событий — дверь отладки, а не архив.
  const edge = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const [deliveries, events] = await Promise.all([
    prisma.webhookDelivery.deleteMany({ where: { createdAt: { lt: edge }, status: { not: "PENDING" } } }),
    prisma.companyEvent.deleteMany({ where: { createdAt: { lt: edge } } }),
  ]);
  stats.prunedDeliveries = deliveries.count;
  stats.prunedEvents = events.count;
  await prisma.companyRuleRun.deleteMany({ where: { createdAt: { lt: edge } } });
  return stats;
}
