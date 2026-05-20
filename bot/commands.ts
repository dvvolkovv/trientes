import type { SessionRecord } from "./types";

export interface CommandDeps {
  session: {
    reset: (userId: number) => Promise<void>;
    get: (userId: number) => Promise<SessionRecord | null>;
    getVerbose: (userId: number) => Promise<boolean>;
    setVerbose: (userId: number, on: boolean) => Promise<void>;
  };
  runner: {
    isActive: (userId: number) => boolean;
    cancel: (userId: number) => void;
  };
  reply: (text: string) => Promise<void>;
}

export async function handleCommand(
  command: string,
  userId: number,
  deps: CommandDeps,
): Promise<void> {
  const cmd = command.trim().split(/\s+/)[0];
  switch (cmd) {
    case "/whoami":
      await deps.reply(`твой telegram user_id: \`${userId}\``);
      return;
    case "/new":
      await deps.session.reset(userId);
      await deps.reply("новая сессия — следующее сообщение начнёт с чистого листа");
      return;
    case "/cancel":
      if (deps.runner.isActive(userId)) {
        deps.runner.cancel(userId);
        await deps.reply("отменяю текущую задачу…");
      } else {
        await deps.reply("нечего отменять — активной задачи нет");
      }
      return;
    case "/verbose": {
      const current = await deps.session.getVerbose(userId);
      await deps.session.setVerbose(userId, !current);
      await deps.reply(
        !current ? "verbose режим вкл — увидишь каждый tool call" : "verbose выкл",
      );
      return;
    }
    case "/status": {
      const rec = await deps.session.get(userId);
      const running = deps.runner.isActive(userId);
      if (!rec) {
        await deps.reply(
          running
            ? "нет активной сессии в Redis, но процесс claude запущен (странно)"
            : "нет активной сессии. напиши что-нибудь — начнём с нуля",
        );
        return;
      }
      const since = Math.round((Date.now() - rec.lastActivity) / 1000);
      await deps.reply(
        [
          `session_id: \`${rec.claudeSessionId}\``,
          `последняя активность: ${since}с назад`,
          `процесс claude: ${running ? "запущен" : "idle"}`,
        ].join("\n"),
      );
      return;
    }
    default:
      await deps.reply(
        "неизвестная команда. доступны: /new /status /cancel /verbose /whoami",
      );
  }
}
