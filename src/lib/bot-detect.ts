// Rough bot-detection for analytics — we'd rather over-flag and under-count
// than ship analytics that mixes bot crawls with human traffic. Conservative:
// any UA containing one of these substrings is treated as a bot.
const BOT_PATTERNS = [
  "bot", "crawl", "spider", "slurp", "fetch", "monitor", "preview",
  "headless", "phantom", "selenium", "puppeteer", "playwright",
  "lighthouse", "pingdom", "uptime", "axios/", "curl/", "wget/",
  "python-requests", "go-http", "node-fetch", "okhttp",
];

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return true; // missing UA → bot
  const lower = ua.toLowerCase();
  return BOT_PATTERNS.some((p) => lower.includes(p));
}
