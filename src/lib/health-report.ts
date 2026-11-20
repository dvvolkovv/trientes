// Ночной отчёт здоровья: что система знает о себе сама и присылает в Telegram
// владельцу. Поломку стакана на /exchange (12 часов 429 от службы заявок)
// нашли руками через awk по логам nginx — отчёт существует, чтобы следующую
// такую нашли не руками.
//
// Четыре взгляда, и ни один не выдумывает чисел:
//  • прогоны — по свежести того, что каждый прогон пишет (ключ Redis или
//    строка в базе), а не по журналу запусков: журнала нет, а данные есть;
//  • карточки — коды ошибок чтения сети и расхождения, как их записали слайсы
//    S/T/V/W/Y/Z;
//  • nginx — доли ответов за окно, которое лог реально покрывает (после
//    ротации это не сутки, и отчёт говорит, сколько именно);
//  • страницы — живой GET снаружи, через тот же домен.

import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import { KEYS, TTL } from "@/lib/sync/keys";
import { RUN_COINPAPRIKA, quotaBlocked, readRunState } from "@/lib/sync/run-state";
import { OWN_DEX_NAME } from "@/lib/coin-card-dex-market";
import { stalestQuoteAt, type MarketQuote } from "@/lib/markets";
import { QUOTA_SERVICES, budgetVerdict, type BudgetVerdict } from "@/lib/quota/budget";
import { readSpend } from "@/lib/quota/ledger";

/**
 * Старше этого — карточка табло считается брошенной. Полный круг обхода при
 * живой пропускной способности источника — три-пять часов, восемь часов это
 * два круга.
 */
export const MARKETS_STALE_MINUTES = 480;

/** Окно, за которое считаются ответы nginx. */
export const LOG_WINDOW_HOURS = 24;
/** Путь, который чаще других отвечал ошибкой, попадает в отчёт — не больше этого числа. */
export const TOP_FAULTS = 3;

export type ProbeState = "ok" | "stale" | "missing";

export interface Probe {
  /** Человеческое имя прогона: «цены», «факты сетей». */
  name: string;
  /** Сколько минут назад прогон в последний раз что-то записал; null — не записал ничего. */
  ageMinutes: number | null;
  /** Старше этого — прогон считается замолчавшим. */
  maxAgeMinutes: number;
  state: ProbeState;
}

export interface LogFault {
  status: number;
  path: string;
  count: number;
}

export interface LogSummary {
  /** Часы, которые лог реально покрывает: после ротации меньше окна. */
  hours: number;
  total: number;
  /** Ответы 5xx — наша вина. */
  server: number;
  /** 429 — нас режут по частоте. */
  tooMany: number;
  /** 404 — просим то, чего нет. */
  notFound: number;
  faults: LogFault[];
  /** Клиент с наибольшим числом ошибок: одна забытая вкладка видна только так. */
  worstClient: { ip: string; count: number } | null;
}

export interface CardsHealth {
  cards: number;
  /** Карточки сетей, у которых чтение фактов кончилось ошибкой: код → сколько. */
  factsErrors: Record<string, number>;
  /** Факты прочитаны, но давно. */
  factsStale: number;
  supplyErrors: Record<string, number>;
  /** Карточки, где сеть расходится с заявленным. */
  mismatched: number;
}

/**
 * Чужая служба, которая отвечает «запас исчерпан». Это состояние службы, а не
 * сбой прогона: повторять нечего, пока запас не обновится, — поэтому строка
 * объясняет причину, а не повторяет симптом замолчавшего прогона.
 */
export interface QuotaBlock {
  name: string;
  /** Когда прогон в последний раз получил отказ по запасу. */
  since: Date;
  /** Когда служба в последний раз ответила по-настоящему; null — в памяти такого нет. */
  lastOkAt: Date | null;
}

/**
 * Расход запаса одной чужой службы. `verdict: null` — счётчика нет вовсе (нет
 * Redis или окно пустое): это «неизвестно», а не ноль, и отчёт говорит так.
 */
export interface QuotaRow {
  label: string;
  verdict: BudgetVerdict | null;
}

export interface PageCheck {
  path: string;
  status: number | null;
  ms: number;
}

export interface HealthFacts {
  at: Date;
  probes: Probe[];
  cards: CardsHealth;
  /** Ждут человека: карточки, точки, заявки. */
  queue: { cards: number; points: number };
  /** null — лог nginx недоступен (нет прав, нет файла). */
  log: LogSummary | null;
  pages: PageCheck[];
  /** Чужие службы, упёршиеся в свой запас: пусто — все отвечают. */
  quotaBlocks: QuotaBlock[];
  /** Расход нашего запаса по службам. Считается по нашим счётчикам, без запросов наружу. */
  quotaSpend: QuotaRow[];
  /** Новые люди за сутки. */
  signups: number;
}

/** Страницы живого GET: главная, карточка монеты и фид навигатора — три разных пути через базу и кэш. */
export const HEALTH_PAGES = ["/en", "/en/coin/bitcoin", "/api/crypto-map/poi?bbox=37.5,55.6,37.8,55.9"] as const;

const COMBINED = /^(\S+) \S+ \S+ \[([^\]]+)\] "(?:[A-Z]+) (\S+)[^"]*" (\d{3}) /;
const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** Время строки лога nginx (`09/Nov/2026:22:18:01 +0000`) в миллисекундах, или null. */
export function logTime(stamp: string): number | null {
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(stamp);
  if (!m) return null;
  const month = MONTHS[m[2]!];
  if (month === undefined) return null;
  const utc = Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
  const offset = (Number(m[8]) * 60 + Number(m[9])) * 60_000 * (m[7] === "-" ? -1 : 1);
  return utc - offset;
}

/** Путь без строки запроса: `/api/x?page=2` и `/api/x?page=3` — один и тот же путь. */
const bare = (path: string) => path.split("?")[0]!;

/**
 * Доли ответов nginx по строкам лога, начиная с `since`. Ошибочные пути считаются
 * по (статус, путь): 2 926 ответов 404 одному адресу — это одна поломка, а не 2 926.
 */
export function summarizeAccessLog(lines: Iterable<string>, since: Date): LogSummary {
  const from = since.getTime();
  let first: number | null = null;
  let last = from;
  let total = 0;
  let server = 0;
  let tooMany = 0;
  let notFound = 0;
  const faults = new Map<string, LogFault>();
  const clients = new Map<string, number>();
  for (const line of lines) {
    const m = COMBINED.exec(line);
    if (!m) continue;
    const at = logTime(m[2]!);
    if (at === null || at < from) continue;
    const status = Number(m[4]);
    total += 1;
    if (first === null || at < first) first = at;
    if (at > last) last = at;
    if (status >= 500) server += 1;
    else if (status === 429) tooMany += 1;
    else if (status === 404) notFound += 1;
    else continue;
    const path = bare(m[3]!);
    const key = `${status} ${path}`;
    const seen = faults.get(key);
    if (seen) seen.count += 1;
    else faults.set(key, { status, path, count: 1 });
    clients.set(m[1]!, (clients.get(m[1]!) ?? 0) + 1);
  }
  const worst = [...clients.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    hours: first === null ? 0 : Math.round(((last - first) / 3_600_000) * 10) / 10,
    total,
    server,
    tooMany,
    notFound,
    faults: [...faults.values()].sort((a, b) => b.count - a.count).slice(0, TOP_FAULTS),
    worstClient: worst ? { ip: worst[0], count: worst[1] } : null,
  };
}

/** Прогон по возрасту того, что он записал. */
export function probe(name: string, at: Date | null, maxAgeMinutes: number, now: Date): Probe {
  if (!at) return { name, ageMinutes: null, maxAgeMinutes, state: "missing" };
  const ageMinutes = Math.round((now.getTime() - at.getTime()) / 60_000);
  return { name, ageMinutes, maxAgeMinutes, state: ageMinutes > maxAgeMinutes ? "stale" : "ok" };
}

const pluralRu = (n: number, one: string, few: string, many: string) => {
  const t = n % 100;
  if (t >= 11 && t <= 14) return many;
  const d = n % 10;
  return d === 1 ? one : d >= 2 && d <= 4 ? few : many;
};

/** Возраст словами: «4 мин», «3 ч 10 мин», «—». */
export function ageWords(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 90) return `${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

const minutesSince = (at: Date, now: Date) => Math.round((now.getTime() - at.getTime()) / 60_000);

const pct = (part: number, whole: number) => (whole === 0 ? "0%" : `${Math.round((part / whole) * 1000) / 10}%`);
const codes = (m: Record<string, number>) =>
  Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${code} ×${n}`)
    .join(", ");

/**
 * Раздел расхода запаса. Правило слайса AA остаётся: двадцать ровных строк
 * перестают читать, поэтому строка печатается только у службы, где истрачено
 * больше половины запаса или прогноз выше запаса. Всё в норме — одна строка.
 *
 * **Ни одного запроса наружу этот раздел не делает**: он читает только наши
 * счётчики. Иначе измерение само тратило бы то, что измеряет.
 */
export function renderQuotaSection(rows: QuotaRow[]): string[] {
  if (rows.length === 0) return [];
  const loud: string[] = [];
  for (const r of rows) {
    if (!r.verdict) {
      loud.push(`• ${r.label}: не записал ничего`);
      continue;
    }
    const v = r.verdict;
    if (v.level !== "loud") continue;
    const parts = [`истрачено ${v.spent}`];
    if (v.budget !== null) parts.push(`из ${v.budget}`);
    if (v.remaining !== null) parts.push(`осталось ${v.remaining}`);
    parts.push(`к концу месяца ожидается ${v.projected}`);
    const wall = v.exhaustsOn ? `, запас кончится ${v.exhaustsOn.toISOString().slice(0, 10)}` : "";
    loud.push(`• ${r.label}: ${parts.join(", ")}${wall}`);
  }
  if (loud.length === 0) return ["", "Запас чужих служб: запасы в норме."];
  return ["", "Запас чужих служб:", ...loud];
}

/**
 * Отчёт одним сообщением Telegram: сначала то, что требует человека, потом ровные
 * строки. Молчание — хорошая новость: у прогона, который успел, строки нет.
 */
export function renderHealthReport(f: HealthFacts): string {
  const out: string[] = [];
  const date = f.at.toISOString().slice(0, 16).replace("T", " ");
  out.push(`Здоровье Trientes, ${date} UTC`);

  const silent = f.probes.filter((p) => p.state !== "ok");
  const lines: string[] = [];
  for (const p of silent) {
    lines.push(p.state === "missing" ? `• ${p.name}: не записал ничего` : `• ${p.name}: тишина ${ageWords(p.ageMinutes)} (норма ${ageWords(p.maxAgeMinutes)})`);
  }
  if (lines.length) {
    out.push("", `Замолчали прогоны (${silent.length} из ${f.probes.length}):`, ...lines);
  } else {
    out.push("", `Прогоны: все ${f.probes.length} свежие.`);
  }

  if (f.quotaBlocks.length) {
    out.push(
      "",
      "Чужие службы:",
      ...f.quotaBlocks.map((q) =>
        q.lastOkAt
          ? `• ${q.name}: запас исчерпан ${ageWords(minutesSince(q.since, f.at))} назад, последняя удачная выборка ${ageWords(minutesSince(q.lastOkAt, f.at))} назад`
          : `• ${q.name}: запас исчерпан ${ageWords(minutesSince(q.since, f.at))}, удачной выборки в памяти нет`,
      ),
    );
  }

  out.push(...renderQuotaSection(f.quotaSpend));

  const dead = f.pages.filter((p) => p.status === null || p.status >= 400);
  if (dead.length) out.push("", "Страницы не отвечают:", ...dead.map((p) => `• ${p.path}: ${p.status ?? "нет ответа"} (${p.ms} мс)`));

  const c = f.cards;
  const cardLines = [`Карточки сетей: ${c.cards}.`];
  if (Object.keys(c.factsErrors).length) cardLines.push(`Ошибки чтения сети: ${codes(c.factsErrors)}.`);
  if (c.factsStale) cardLines.push(`Факты старше суток: ${c.factsStale}.`);
  if (Object.keys(c.supplyErrors).length) cardLines.push(`Ошибки выпуска: ${codes(c.supplyErrors)}.`);
  if (c.mismatched) cardLines.push(`Расхождений с сетью: ${c.mismatched}.`);
  out.push("", ...cardLines);

  if (f.log) {
    const l = f.log;
    out.push(
      "",
      `nginx за ${ageWords(Math.round(l.hours * 60))}: ${l.total} ${pluralRu(l.total, "запрос", "запроса", "запросов")}, 5xx ${pct(l.server, l.total)}, 429 ${pct(l.tooMany, l.total)}, 404 ${pct(l.notFound, l.total)}.`,
    );
    if (l.faults.length) out.push(...l.faults.map((x) => `• ${x.status} ×${x.count} ${x.path}`));
    if (l.worstClient && l.worstClient.count >= 100) out.push(`• больше всех ошибок одному клиенту: ${l.worstClient.count} (${l.worstClient.ip})`);
  } else {
    out.push("", "nginx: лог недоступен — отчёт его не читал.");
  }

  const waiting: string[] = [];
  if (f.queue.cards) waiting.push(`карточки ${f.queue.cards}`);
  if (f.queue.points) waiting.push(`точки ${f.queue.points}`);
  out.push("", waiting.length ? `Ждут модерации: ${waiting.join(", ")}.` : "Ждут модерации: ничего.");
  out.push(`Новых людей за сутки: ${f.signups}.`);

  return out.join("\n");
}

/**
 * Свежесть табло — по самой ветхой карточке, а не по времени записи снимка.
 *
 * Время записи мерило не то: с 18 ноября Yahoo отдаёт одну-две котировки из
 * десяти за прогон, а прогону, которому отказали во всём, писать нечего — и
 * «тишина 2 ч» в отчёте означала обычную работу источника, а не поломку. С
 * продлением срока жизни снимка (пустой ответ его перезаписывает) время записи
 * врало бы и в другую сторону: оно всегда свежее. Голодание одного инструмента
 * и замолчавший источник видны только по штампам самих карточек.
 */
async function marketsStalestAt(redis: Redis): Promise<Date | null> {
  const raw = await redis.get(KEYS.markets).catch(() => null);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? stalestQuoteAt(parsed as MarketQuote[]) : null;
  } catch {
    return null;
  }
}

/** Возраст записи ключа Redis: ключи ставятся с TTL, остаток TTL — её возраст. */
async function redisWrittenAt(redis: Redis, key: string, ttlSeconds: number, now: Date): Promise<Date | null> {
  const left = await redis.ttl(key).catch(() => -2);
  if (left < 0) return null; // −2 нет ключа, −1 без TTL: возраст неизвестен, а не нулевой
  return new Date(now.getTime() - (ttlSeconds - left) * 1_000);
}

const count = (rows: { _count: number; key: string | null }[]) => {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.key) out[r.key] = r._count;
  return out;
};

export interface HealthDeps {
  prisma: PrismaClient;
  redis: Redis;
  now?: Date;
  /** Строки лога nginx; бросает — отчёт скажет, что лог недоступен. */
  readLog?: (since: Date) => Promise<string[]>;
  /** Живой GET страницы; без него страницы не проверяются. */
  fetchPage?: (path: string) => Promise<{ status: number; ms: number }>;
}

export async function collectHealth(deps: HealthDeps): Promise<HealthFacts> {
  const { prisma, redis } = deps;
  const now = deps.now ?? new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000);

  const last = async (
    table: { findFirst: (a: unknown) => Promise<Record<string, unknown> | null> },
    field: string,
  ): Promise<Date | null> => {
    const row = await table.findFirst({ orderBy: { [field]: "desc" }, select: { [field]: true } });
    const at = row?.[field];
    return at instanceof Date ? at : null;
  };

  const [priceAt, factsAt, supplyAt, indexAt, poiAt] = await Promise.all([
    last(prisma.coinSnapshot as never, "fetchedAt"),
    last(prisma.coinCardChainFacts as never, "checkedAt"),
    last(prisma.coinCardSupply as never, "checkedAt"),
    last(prisma.coinCardPriceIndex as never, "computedAt"),
    last(prisma.osmCryptoPoi as never, "syncedAt"),
  ]);
  // Рынки читаются не одним прогоном: снимки бирж — сверкой слайса C, свой
  // обмен — отдельным часовым прогоном. Поэтому свежести «ценового индекса»
  // мало: он считается по тем рынкам, что ответили, и молчание одного
  // источника в нём не видно. Так и вышло 13 ноября — чтение своего обмена
  // сломалось, а отчёт пять дней говорил, что всё свежо.
  const [ownDexAgg, stalestMarketAgg] = await Promise.all([
    prisma.coinCardMarket.aggregate({
      _max: { checkedAt: true },
      where: { kind: "DEX", exchangeName: OWN_DEX_NAME },
    }) as never as Promise<{ _max: { checkedAt: Date | null } }>,
    prisma.coinCardMarket.aggregate({ _min: { checkedAt: true } }) as never as Promise<{
      _min: { checkedAt: Date | null };
    }>,
  ]);

  const [listAt, globalAt, marketsAt, newsAt, cpRun] = await Promise.all([
    redisWrittenAt(redis, KEYS.topList, TTL.snapshot, now),
    redisWrittenAt(redis, KEYS.globalStats, TTL.globalStats, now),
    marketsStalestAt(redis),
    redisWrittenAt(redis, KEYS.news, TTL.news, now),
    // Обход каталога бирж своего следа в базе не оставляет: строки `Exchange`
    // трогает и прогон CoinGecko. Поэтому прогон пишет факт о себе сам.
    readRunState(redis, RUN_COINPAPRIKA),
  ]);

  // Нормы — вдвое-втрое больше периода прогона: один пропуск не повод будить человека.
  const probes: Probe[] = [
    probe("цены монет", priceAt, 40, now),
    probe("снимок списка (Redis)", listAt, 40, now),
    probe("мировые итоги", globalAt, 90, now),
    // Норма вдвое больше полного круга обхода: служба отдаёт одну-две карточки
    // из десяти за прогон (замер 18–20 ноября), то есть круг — три-пять часов.
    probe("табло рынков (ветхая карточка)", marketsAt, MARKETS_STALE_MINUTES, now),
    probe("новости", newsAt, 120, now),
    probe("факты сетей", factsAt, 180, now),
    probe("выпуск монет", supplyAt, 180, now),
    probe("ценовой индекс карточек", indexAt, 40, now),
    probe("рынок своего обмена", ownDexAgg._max.checkedAt, 180, now),
    // Самая ветхая строка рынка: источник, перестающий их трогать, виден здесь
    // даже тогда, когда остальные источники работают.
    probe("рынки карточек, ветхая строка", stalestMarketAgg._min.checkedAt, 180, now),
    probe("точки BTC Map", poiAt, 36 * 60, now),
  ];

  // Исчерпанный запас месяца — состояние службы: прогон о себе не виноват, и
  // строка «замолчал» каждую ночь до обновления запаса была бы шумом. Поэтому
  // при исчерпанном запасе прогон не мерится по свежести, а причина называется
  // отдельной строкой.
  const quotaBlocks: QuotaBlock[] = [];
  const cpQuotaAt = quotaBlocked(cpRun) ? cpRun?.quotaAt ?? null : null;
  if (cpQuotaAt) {
    quotaBlocks.push({ name: "CoinPaprika", since: cpQuotaAt, lastOkAt: cpRun?.okAt ?? null });
  } else {
    // Норма — втрое больше периода: прогон идёт раз в час (`25 * * * *`).
    probes.push(probe("каталог бирж (CoinPaprika)", cpRun?.okAt ?? null, 180, now));
  }

  // Расход запаса — по нашим счётчикам. Запросов наружу раздел не делает.
  const quotaSpend: QuotaRow[] = [];
  for (const service of Object.values(QUOTA_SERVICES)) {
    const spend = await readSpend(redis as never, service.key, now);
    quotaSpend.push({
      label: service.label,
      verdict: spend ? budgetVerdict(service, spend.bgMonth + spend.uiMonth, now) : null,
    });
  }

  const [cards, factsErr, factsStale, supplyErr, mismatched, pendingCards, pendingPoints, signups] = await Promise.all([
    prisma.coinCardChainFacts.count(),
    prisma.coinCardChainFacts.groupBy({ by: ["checkError"], _count: true, where: { checkError: { not: null } } }) as never as Promise<
      { _count: number; checkError: string | null }[]
    >,
    prisma.coinCardChainFacts.count({ where: { checkedAt: { lt: dayAgo } } }),
    prisma.coinCardSupply.groupBy({ by: ["checkError"], _count: true, where: { checkError: { not: null } } }) as never as Promise<
      { _count: number; checkError: string | null }[]
    >,
    prisma.coinCardChainFacts.count({ where: { NOT: { mismatches: { isEmpty: true } } } }),
    prisma.coinCard.count({ where: { status: "PENDING" } }),
    prisma.companyPoint.count({ where: { status: "PENDING" } }),
    prisma.user.count({ where: { createdAt: { gte: dayAgo } } }),
  ]);

  let log: LogSummary | null = null;
  if (deps.readLog) {
    try {
      log = summarizeAccessLog(await deps.readLog(new Date(now.getTime() - LOG_WINDOW_HOURS * 3_600_000)), new Date(now.getTime() - LOG_WINDOW_HOURS * 3_600_000));
    } catch {
      log = null; // нет прав или файла: это не повод терять остальной отчёт
    }
  }

  const pages: PageCheck[] = [];
  if (deps.fetchPage) {
    for (const path of HEALTH_PAGES) {
      try {
        const r = await deps.fetchPage(path);
        pages.push({ path: bare(path), status: r.status, ms: r.ms });
      } catch {
        pages.push({ path: bare(path), status: null, ms: 0 });
      }
    }
  }

  return {
    at: now,
    probes,
    cards: {
      cards,
      factsErrors: count(factsErr.map((r) => ({ _count: r._count, key: r.checkError }))),
      factsStale,
      supplyErrors: count(supplyErr.map((r) => ({ _count: r._count, key: r.checkError }))),
      mismatched,
    },
    queue: { cards: pendingCards, points: pendingPoints },
    log,
    pages,
    quotaBlocks,
    quotaSpend,
    signups,
  };
}

/** Лог nginx: путь переопределяется для проверок и переноса на другую машину. */
export const NGINX_ACCESS_LOG = process.env.NGINX_ACCESS_LOG ?? "/var/log/nginx/access.log";

/**
 * Строки лога nginx. Права на файл даны пользователю отдельно (ACL на каталоге
 * `/var/log/nginx`, чтобы ротация их не теряла); нет прав или файла — бросает, и
 * отчёт выходит без раздела nginx, а не падает целиком.
 */
export async function readNginxLog(_since: Date): Promise<string[]> {
  const { readFile } = await import("node:fs/promises");
  return (await readFile(NGINX_ACCESS_LOG, "utf8")).split("\n");
}

/** Живой GET страницы снаружи, через тот же домен, что видят люди. */
export async function fetchPage(path: string): Promise<{ status: number; ms: number }> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://trientes.org";
  const started = Date.now();
  const res = await fetch(`${base}${path}`, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000) });
  return { status: res.status, ms: Date.now() - started };
}

/**
 * Кому уходит отчёт: `HEALTH_REPORT_CHAT_IDS`, а без него — тем, кому и так отвечает
 * бот (`BOT_ALLOWED_USER_IDS`): у админов сайта Telegram не привязан, и notifyUser
 * им ничего не доставит.
 */
export function healthChatIds(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.HEALTH_REPORT_CHAT_IDS ?? env.BOT_ALLOWED_USER_IDS ?? "";
  return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => /^-?\d+$/.test(s)))];
}

export interface HealthReportResult {
  text: string;
  sent: string[];
  failed: { chatId: string; reason: string }[];
}

/** Собрать отчёт и отправить его в Telegram. Без адресатов — только собрать. */
export async function sendHealthReport(deps: HealthDeps & { send?: (chatId: string, text: string) => Promise<{ ok: boolean; reason?: string }>; chatIds?: string[] }): Promise<HealthReportResult> {
  const facts = await collectHealth({ readLog: readNginxLog, fetchPage, ...deps });
  const text = renderHealthReport(facts);
  const chatIds = deps.chatIds ?? healthChatIds();
  const send = deps.send ?? (await import("@/lib/notify")).sendTelegram;
  const sent: string[] = [];
  const failed: { chatId: string; reason: string }[] = [];
  for (const chatId of chatIds) {
    const r = await send(chatId, text);
    if (r.ok) sent.push(chatId);
    else failed.push({ chatId, reason: r.reason ?? "unknown" });
  }
  return { text, sent, failed };
}
