/**
 * Прогон: прочитать ящик заявок и завести дела (слайс CI).
 *
 * Письмо, которое не дало заявки, остаётся в ящике непрочитанным — и это
 * сознательно: мы не умеем ответить тому, чей домен не доказан, а ящик с
 * непрочитанным письмом виден человеку. Прочитанным помечается только то, что
 * мы действительно разобрали.
 */

import { acceptInbound, type SkipReason } from "@/lib/claims/inbound";
import { mailboxConfig, readInbox } from "@/lib/claims/mailbox";

export type ClaimSweepStats = {
  read: number;
  claimed: number;
  appended: number;
  skipped: Record<string, number>;
  error?: string;
};

export async function runClaimMailboxSweep(): Promise<ClaimSweepStats> {
  const stats: ClaimSweepStats = { read: 0, claimed: 0, appended: 0, skipped: {} };
  const config = mailboxConfig();
  if (config === null) {
    stats.error = "mailbox_not_configured";
    return stats;
  }

  let inbox: Awaited<ReturnType<typeof readInbox>>;
  try {
    inbox = await readInbox(config);
  } catch (err) {
    stats.error = err instanceof Error ? err.message : "imap_failed";
    return stats;
  }

  const handled: number[] = [];
  for (const message of inbox.messages) {
    stats.read += 1;
    try {
      const outcome = await acceptInbound(message, config.authServer);
      if (outcome.kind === "claimed") {
        stats.claimed += 1;
        handled.push(message.uid);
      } else if (outcome.kind === "appended") {
        stats.appended += 1;
        handled.push(message.uid);
      } else {
        const reason: SkipReason = outcome.reason;
        stats.skipped[reason] = (stats.skipped[reason] ?? 0) + 1;
        // Прочитанное ранее письмо помечаем: иначе оно попадало бы в выборку
        // каждый прогон и вечно считалось бы заново.
        if (reason === "already_read") handled.push(message.uid);
      }
    } catch (err) {
      // Одно негодное письмо не должно ронять весь прогон: остальные ждут
      // своего разбора в том же ящике.
      console.error("[claims] failed to accept message", message.messageId, err);
      stats.skipped.failed = (stats.skipped.failed ?? 0) + 1;
    }
  }

  try {
    await inbox.done(handled);
  } catch (err) {
    console.error("[claims] failed to flag handled messages", err);
  }

  return stats;
}
