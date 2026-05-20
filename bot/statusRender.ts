function short(path: string, max = 60): string {
  const cleaned = path.replace(/^\/home\/dv\/trientes\//, "");
  if (cleaned.length <= max) return cleaned;
  return "…" + cleaned.slice(-(max - 1));
}

function bashStatus(command: string): string {
  const lower = command.toLowerCase();
  if (/\bgit\s+commit\b/.test(lower)) return "💾 коммичу";
  if (/\bgit\s+push\b/.test(lower)) return "🚀 пушу";
  if (/\bpm2\s+(reload|restart|start)\b/.test(lower)) return "♻️ рестарт prod";
  if (/\b(npm|pnpm|yarn)\s+(test|run\s+test)\b/.test(lower)) return "🧪 запускаю тесты";
  if (/\bvitest\b/.test(lower)) return "🧪 запускаю тесты";
  if (/\bnpm\s+(install|i)\b/.test(lower)) return "📦 ставлю зависимости";
  if (/\bgit\s+pull\b/.test(lower)) return "⤵️ git pull";
  const preview = command.length > 60 ? command.slice(0, 57) + "…" : command;
  return `⚙️ bash: ${preview}`;
}

export function renderToolStatus(toolName: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case "Read":
      return `📖 читаю ${short(String(i.file_path ?? ""))}`;
    case "Edit":
      return `✏️ правлю ${short(String(i.file_path ?? ""))}`;
    case "Write":
      return `📝 пишу ${short(String(i.file_path ?? ""))}`;
    case "Grep":
      return `🔎 ищу ${String(i.pattern ?? "")}`;
    case "Glob":
      return `🔎 ищу файлы ${String(i.pattern ?? "")}`;
    case "Bash":
      return bashStatus(String(i.command ?? ""));
    default:
      return `🔧 ${toolName}`;
  }
}
