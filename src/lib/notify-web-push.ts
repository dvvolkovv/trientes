// web-push wrapper. Configures VAPID once at import time and exposes a single
// send-to-user helper that fans out to all of the user's subscriptions,
// pruning rows that the push service has marked as expired (404 / 410).

import webpush from "web-push";
import { prisma } from "@/lib/prisma";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:notifications@trientes.org";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export type WebPushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export type WebPushResult = { sent: number; pruned: number };

export async function sendWebPushToUser(userId: string, payload: WebPushPayload): Promise<WebPushResult> {
  if (!ensureConfigured()) return { sent: 0, pruned: 0 };
  const subs = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (subs.length === 0) return { sent: 0, pruned: 0 };

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/",
    tag: payload.tag,
  });

  let sent = 0;
  const toPrune: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        sent++;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          toPrune.push(s.id);
        }
      }
    }),
  );

  if (toPrune.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: toPrune } } }).catch(() => {});
  }
  return { sent, pruned: toPrune.length };
}
