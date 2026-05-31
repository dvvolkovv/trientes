// Unified notification helpers. Channels in priority order: Telegram, then
// Email. Both are best-effort: if a channel is unconfigured or fails, we just
// skip it and report which channels actually delivered.

import { prisma } from "@/lib/prisma";
import { sendEmail as sendEmailViaResend } from "@/lib/email";

export type NotifyChannel = "telegram" | "email";

export type NotifyInput = {
  userId: string;
  text: string;        // plain text body (also used as Telegram message)
  subject?: string;    // email subject; falls back to first line of `text`
  html?: string;       // optional rich HTML for email; falls back to <pre>text</pre>
};

export type NotifyResult = {
  delivered: NotifyChannel[];
  skipped: { channel: NotifyChannel; reason: string }[];
};

// Send a Telegram message via the existing TELEGRAM_BOT_TOKEN. The user must
// have started a conversation with the bot at least once (or signed in via the
// Telegram Login widget) for this to succeed — Telegram does not let bots DM
// arbitrary users.
async function sendTelegram(chatId: string, text: string): Promise<{ ok: boolean; reason?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, reason: "no_token" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `tg_http_${res.status}: ${body.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "fetch_error" };
  }
}

// Email goes through the shared src/lib/email.ts wrapper (Resend SDK). That
// helper already no-ops silently when RESEND_API_KEY is unset.

// Resolve the Telegram chat ID for a user from their linked Account (Telegram
// Login Widget stores it as providerAccountId). Returns null if not linked.
async function telegramChatIdForUser(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "telegram" },
    select: { providerAccountId: true },
  });
  return account?.providerAccountId ?? null;
}

export async function notifyUser(input: NotifyInput): Promise<NotifyResult> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true, notifyTelegram: true, notifyEmail: true },
  });
  if (!user) return { delivered: [], skipped: [{ channel: "telegram", reason: "no_user" }] };

  const delivered: NotifyChannel[] = [];
  const skipped: { channel: NotifyChannel; reason: string }[] = [];

  if (user.notifyTelegram) {
    const chatId = await telegramChatIdForUser(input.userId);
    if (!chatId) {
      skipped.push({ channel: "telegram", reason: "not_linked" });
    } else {
      const r = await sendTelegram(chatId, input.text);
      if (r.ok) delivered.push("telegram");
      else skipped.push({ channel: "telegram", reason: r.reason ?? "unknown" });
    }
  } else {
    skipped.push({ channel: "telegram", reason: "opted_out" });
  }

  if (user.notifyEmail) {
    if (!user.email) {
      skipped.push({ channel: "email", reason: "no_address" });
    } else {
      const subject = input.subject ?? input.text.split("\n", 1)[0]!.slice(0, 120);
      const r = await sendEmailViaResend({ to: user.email, subject, text: input.text, html: input.html });
      if (r.ok) delivered.push("email");
      else skipped.push({ channel: "email", reason: r.reason ?? "unknown" });
    }
  } else {
    skipped.push({ channel: "email", reason: "opted_out" });
  }

  return { delivered, skipped };
}
