/**
 * Расход запаса чужих служб — числами, в консоль. Только читает.
 *
 * Запросов наружу не делает ни одного: показывает наши счётчики и то, что из
 * них выводит бюджет. Запуск: `npx tsx scripts/quota-report.ts`.
 */

import { config } from "dotenv";

config();

import { redis } from "@/lib/redis";
import {
  QUOTA_SERVICES,
  budgetVerdict,
  dailyBackgroundAllowance,
  runBudget,
} from "@/lib/quota/budget";
import { readSpend } from "@/lib/quota/ledger";

async function main() {
  if (redis.status === "wait" || redis.status === "end") await redis.connect();
  const now = new Date();
  console.log(`Расход запаса чужих служб, ${now.toISOString().slice(0, 16).replace("T", " ")} UTC\n`);

  for (const service of Object.values(QUOTA_SERVICES)) {
    const spend = await readSpend(redis as never, service.key, now);
    if (!spend) {
      console.log(`${service.label}: счётчик недоступен — расход неизвестен (это не ноль).`);
      continue;
    }
    const total = spend.bgMonth + spend.uiMonth;
    const v = budgetVerdict(service, total, now);
    const daily = dailyBackgroundAllowance(service, spend.bgMonth, now);
    // Те же числа, что получит часовой обход каталога: один вызов списка,
    // потолок 25 подробностей.
    const next = runBudget({
      service,
      bgSpentMonth: spend.bgMonth,
      bgSpentToday: spend.bgToday,
      uiSpentMonth: spend.uiMonth,
      runsPerDay: 24,
      fixedCostPerRun: 1,
      perRunCap: 25,
      now,
    });

    const budget = service.monthlyBudget === null ? "месячного запаса нет" : `наш запас ${service.monthlyBudget}`;
    const upstream = service.upstreamMonthly === null ? "" : ` (у службы ${service.upstreamMonthly})`;
    console.log(
      `${service.label}: за месяц ${total} (прогоны ${spend.bgMonth}, страницы ${spend.uiMonth}); ` +
        `за сутки ${spend.bgToday + spend.uiToday} (прогоны ${spend.bgToday}, страницы ${spend.uiToday})`,
    );
    console.log(`  ${budget}${upstream}; прогноз к концу месяца ${v.projected}${v.exhaustsOn ? `, запас кончится ${v.exhaustsOn.toISOString().slice(0, 10)}` : ""}`);
    console.log(`  доля фона на сегодня ${daily}; следующему часовому прогону: ${next.allowed ? `${next.calls} вызовов` : `нечего (${next.reason})`}`);
    console.log(`  в отчёт идёт: ${v.level === "loud" ? "да" : "нет (в норме)"}\n`);
  }

  await redis.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
