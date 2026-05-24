import * as dotenv from "dotenv";
dotenv.config({ override: true });
import { setDefaultResultOrder } from "node:dns";
// Node 22 defaults to "verbatim" DNS, which on hosts with broken IPv6 to
// api.telegram.org makes outbound requests hang for ~10s. Force IPv4 first.
setDefaultResultOrder("ipv4first");
import { Bot, type Context, InputFile } from "grammy";
import OpenAI from "openai";
import Redis from "ioredis";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { isAllowed } from "./auth";
import { SessionStore } from "./session";
import { ClaudeRunner } from "./claudeRunner";
import { StatusUpdater, truncate } from "./telegramView";
import { renderToolStatus } from "./statusRender";
import { handleCommand } from "./commands";
import { collectHeadInfo } from "./gitEnrich";
import { downloadTelegramVoice, transcribeBuffer } from "./voice";
import { saveTelegramFile } from "./incoming";
import { createWebhookApp } from "./webhook";
import { parseAttachments } from "./attachments";

const config = loadConfig();
const logger = createLogger(join(config.claudeCwd, "bot/logs"));
const redis = new Redis(config.redisUrl);
const openai = new OpenAI({ apiKey: config.openaiApiKey });
const session = new SessionStore(redis);
const runner = new ClaudeRunner({
  cwd: config.claudeCwd,
  timeoutMs: config.claudeTimeoutMs,
});
const bot = new Bot(config.telegramBotToken);

async function unauthorizedDrop(ctx: Context, snippet: string): Promise<void> {
  await logger.appendUnauthorized({
    ts: new Date().toISOString(),
    userId: ctx.from?.id ?? 0,
    username: ctx.from?.username ?? null,
    textSnippet: snippet.slice(0, 200),
  });
}

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from.id;

  if (text.startsWith("/")) {
    if (text.startsWith("/whoami") || isAllowed(userId, config.allowedUserIds)) {
      await handleCommand(text, userId, {
        session,
        runner,
        reply: (t) => ctx.reply(t).then(() => {}),
      });
    } else {
      await unauthorizedDrop(ctx, text);
    }
    return;
  }

  if (!isAllowed(userId, config.allowedUserIds)) {
    await unauthorizedDrop(ctx, text);
    return;
  }
  await processPrompt(ctx, userId, text);
});

bot.on("message:voice", async (ctx) => {
  const userId = ctx.from.id;
  if (!isAllowed(userId, config.allowedUserIds)) {
    await unauthorizedDrop(ctx, "<voice>");
    return;
  }
  let prompt: string;
  try {
    const { buffer, filename } = await downloadTelegramVoice(
      ctx.message.voice.file_id,
      config.telegramBotToken,
    );
    prompt = await transcribeBuffer(buffer, filename, openai);
  } catch (err) {
    await ctx.reply(
      "не разобрал голос, повтори текстом (ошибка: " +
        (err instanceof Error ? err.message : String(err)).slice(0, 100) +
        ")",
    );
    return;
  }
  await ctx.reply(`🎤 услышал: ${prompt}`);
  await processPrompt(ctx, userId, prompt);
});

// Photo or document → download to /incoming/, then process the caption (if any)
// alongside a marker line so Claude sees the absolute path and can pick it up.
async function handleIncomingFile(
  ctx: Context,
  userId: number,
  fileId: string,
  originalName: string | null,
  caption: string,
): Promise<void> {
  let saved;
  try {
    saved = await saveTelegramFile(fileId, originalName, config.telegramBotToken);
  } catch (err) {
    await ctx.reply(
      "не смог скачать файл (" +
        (err instanceof Error ? err.message : String(err)).slice(0, 120) +
        ")",
    );
    return;
  }
  const sizeKb = Math.max(1, Math.round(saved.sizeBytes / 1024));
  await ctx.reply(
    `📥 файл получен: ${saved.originalName} (${sizeKb} KB) → ${saved.relPath}`,
  );
  // Inject the absolute path so the assistant sees it as a normal incoming file.
  // Caption (if any) is the user instruction; otherwise default to a pickup hint.
  const userText = caption.trim();
  const prompt =
    (userText ? userText + "\n\n" : "") +
    `📎 received: ${saved.absPath}\n` +
    `(original name: ${saved.originalName}, ${sizeKb} KB)`;
  await processPrompt(ctx, userId, prompt);
}

bot.on("message:photo", async (ctx) => {
  const userId = ctx.from.id;
  if (!isAllowed(userId, config.allowedUserIds)) {
    await unauthorizedDrop(ctx, "<photo>");
    return;
  }
  // Telegram sends photo in several size variants — pick the largest by file_size.
  const variants = ctx.message.photo;
  const best = variants.reduce((a, b) =>
    (b.file_size ?? 0) > (a.file_size ?? 0) ? b : a,
  );
  await handleIncomingFile(
    ctx,
    userId,
    best.file_id,
    null,
    ctx.message.caption ?? "",
  );
});

bot.on("message:document", async (ctx) => {
  const userId = ctx.from.id;
  if (!isAllowed(userId, config.allowedUserIds)) {
    await unauthorizedDrop(ctx, "<document>");
    return;
  }
  const doc = ctx.message.document;
  await handleIncomingFile(
    ctx,
    userId,
    doc.file_id,
    doc.file_name ?? null,
    ctx.message.caption ?? "",
  );
});

async function processPrompt(
  ctx: Context,
  userId: number,
  prompt: string,
): Promise<void> {
  if (runner.isActive(userId)) {
    await ctx.reply("текущая задача ещё идёт, /cancel или подожди");
    return;
  }
  const placeholder = await ctx.reply("🤔 думаю...");
  const status = new StatusUpdater(bot, ctx.chat!.id, placeholder.message_id);
  const verbose = await session.getVerbose(userId);
  const existing = await session.get(userId);
  const startedAt = Date.now();
  let writtenSessionId: string | null = existing?.claudeSessionId ?? null;

  try {
    const result = await runner.run({
      userId,
      prompt,
      sessionId: existing?.claudeSessionId ?? null,
      onEvent: (ev) => {
        if (ev.kind === "init" && !writtenSessionId) {
          writtenSessionId = ev.sessionId;
          void session.set(userId, ev.sessionId);
        }
        if (ev.kind === "tool_use") {
          const line = renderToolStatus(ev.toolName, ev.input);
          if (verbose) {
            void ctx.reply(line);
          } else {
            status.update(line);
          }
        }
      },
    });

    await status.flush();

    if (writtenSessionId) {
      await session.touch(userId);
    }

    // Parse attachments / strip markers in every branch — a timed-out or canceled
    // run may still have produced partial text and emitted an attachment first.
    const parsed = parseAttachments(result.finalText || "");
    const attachmentPaths = parsed.paths;
    const partial = parsed.text.trim();
    let reply: string;

    if (result.exitCode === 0) {
      let suffix = "";
      try {
        const head = await collectHeadInfo(config.claudeCwd);
        const filesLine =
          head.files.length > 0
            ? `\nфайлы: ${head.files.slice(0, 10).join(", ")}${head.files.length > 10 ? ", …" : ""}`
            : "";
        suffix = `\n\n✅ готово\nкоммит: \`${head.shortSha}\` — ${head.subject}${filesLine}\n${config.githubRepoUrl}/commit/${head.sha}`;
      } catch {
        suffix = "\n\n✅ готово (git enrich failed)";
      }
      reply = truncate(partial || "(пусто)", 3500) + suffix;
    } else if (result.canceled) {
      reply =
        "⏹ Остановил по твоей команде." +
        (partial ? "\n\nЧто успел сделать:\n" + truncate(partial, 3000) : "");
    } else if (result.timedOut) {
      const mins = Math.round(config.claudeTimeoutMs / 60000);
      reply =
        `⏳ Задача шла дольше ${mins} мин — я остановил её по таймауту, чтобы не зависла. ` +
        "Это не ошибка в коде, просто лимит времени на один заход." +
        (partial ? "\n\nЧто успел к этому моменту:\n" + truncate(partial, 3000) : "") +
        '\n\nНапиши «продолжи» — доделаю с того же места.';
    } else {
      reply =
        `⚠️ Сессия завершилась нештатно (код ${result.exitCode}). Хвост лога для диагностики:\n` +
        "```\n" +
        truncate(result.stderrTail || "(пусто)", 1500) +
        "\n```";
    }

    try {
      await ctx.reply(reply, { parse_mode: "Markdown" });
    } catch {
      // Telegram Markdown parser fails on stray underscores etc. — fall back to plain.
      await ctx.reply(reply);
    }

    const failed: string[] = [];
    for (const rawPath of attachmentPaths) {
      const abs = isAbsolute(rawPath)
        ? rawPath
        : resolve(config.claudeCwd, rawPath);
      if (!existsSync(abs)) {
        failed.push(`${rawPath} (not found)`);
        continue;
      }
      try {
        await ctx.replyWithDocument(new InputFile(abs));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failed.push(`${rawPath} (${msg.slice(0, 80)})`);
      }
    }
    if (failed.length > 0) {
      await ctx.reply(`⚠️ не прицепил: ${failed.join(", ")}`);
    }

    await logger.appendAudit({
      ts: new Date().toISOString(),
      userId,
      prompt,
      sessionId: writtenSessionId,
      claudeExitCode: result.exitCode,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    await ctx.reply(
      "бот упал: " +
        (err instanceof Error ? err.message : String(err)).slice(0, 200),
    );
    await logger.appendAudit({
      ts: new Date().toISOString(),
      userId,
      prompt,
      sessionId: writtenSessionId,
      claudeExitCode: -1,
      durationMs: Date.now() - startedAt,
    });
  }
}

bot.catch((err) => {
  console.error("[bot] unhandled error:", err);
});

const app = createWebhookApp(bot, config.telegramWebhookSecret, redis);
app.listen(config.botPort, "127.0.0.1", () => {
  console.log(
    `[bot] listening on 127.0.0.1:${config.botPort}, cwd=${config.claudeCwd}, whitelist=${[...config.allowedUserIds].join(",") || "(empty)"}`,
  );
});

process.on("SIGTERM", () => {
  console.log("[bot] SIGTERM, shutting down");
  redis.disconnect();
  process.exit(0);
});
