import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Граница: у каждого исходящего запроса к чужой службе есть срок.
 *
 * Своего срока у `fetch` нет. Служба, принявшая соединение и замолчавшая,
 * держит отрисовку страницы ровно столько, сколько молчит, — а страница монеты,
 * биржи и маршрут графика зовут чужие службы **при отрисовке**. 19 ноября это
 * стоило сайта: CoinPaprika исчерпала запас месяца, повторы по 10 и 30 секунд
 * растянули страницу биржи до 50 секунд, обход поисковика по двенадцати языкам
 * догнал веб до 800 МБ, pm2 перезапустил его по памяти — и все посетители
 * получили 502. Ожидание тогда было хотя бы конечным; молчание было бы хуже.
 *
 * Тест читает исходники, а не поведение: написать новый вызов без срока проще
 * всего, и поймать это должна сборка, а не живой прогон.
 */
function filesIn(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesIn(path));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/** Строки, которые считаются сроком: прямой сигнал или свой обёрточный таймер. */
const DEADLINE_MARKERS = ["AbortSignal.timeout", "signal:", "ctrl.abort", "withTimeout"];

describe("исходящие запросы", () => {
  it("каждый модуль с запросом к чужой службе несёт срок", () => {
    const offenders: string[] = [];
    for (const path of [...filesIn("src/lib"), ...filesIn("src/app/api")]) {
      const src = readFileSync(path, "utf8");
      // Запрос именно наружу: внутренние вызовы идут через Prisma и Redis.
      // Два вида вызова: прямой `fetch` и внедрённый (`fetchImpl` — так ходят
      // клиенты CoinGecko, CoinPaprika и читатели сетей, чтобы тесты шли без сети).
      const calls =
        /\bfetch\s*\(\s*[`"']?https?:|\bfetch\s*\(\s*url|\bfetch\s*\(\s*`\$\{/.test(src) ||
        /\bfetchImpl\s*\(/.test(src);
      if (!calls) continue;
      if (!DEADLINE_MARKERS.some((m) => src.includes(m))) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
