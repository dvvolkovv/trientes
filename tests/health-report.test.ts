import { describe, expect, it } from "vitest";
import {
  ageWords,
  logTime,
  probe,
  renderHealthReport,
  summarizeAccessLog,
  type HealthFacts,
} from "@/lib/health-report";

const NOW = new Date("2026-11-09T22:00:00.000Z");
const line = (ip: string, at: string, path: string, status: number) =>
  `${ip} - - [${at}] "GET ${path} HTTP/1.1" ${status} 13 "-" "curl/7.64.1"`;

describe("logTime", () => {
  it("время строки nginx со смещением зоны, и ничего иного", () => {
    expect(logTime("09/Nov/2026:22:18:01 +0000")).toBe(Date.UTC(2026, 10, 9, 22, 18, 1));
    expect(logTime("09/Nov/2026:01:18:01 +0300")).toBe(Date.UTC(2026, 10, 8, 22, 18, 1));
    expect(logTime("09/Nov/2026:22:18:01 -0130")).toBe(Date.UTC(2026, 10, 9, 23, 48, 1));
    expect(logTime("09/Foo/2026:22:18:01 +0000")).toBeNull();
    expect(logTime("вчера")).toBeNull();
  });
});

describe("summarizeAccessLog", () => {
  const since = new Date("2026-11-08T22:00:00.000Z");

  it("доли ответов за окно; строки старше окна и неразобранные не считаются", () => {
    const s = summarizeAccessLog(
      [
        line("1.1.1.1", "07/Nov/2026:10:00:00 +0000", "/en", 200), // старше окна
        line("1.1.1.1", "09/Nov/2026:10:00:00 +0000", "/en", 200),
        line("1.1.1.1", "09/Nov/2026:11:00:00 +0000", "/en", 500),
        line("1.1.1.1", "09/Nov/2026:12:00:00 +0000", "/en", 404),
        line("1.1.1.1", "09/Nov/2026:13:00:00 +0000", "/en", 429),
        "мусор, не строка лога",
      ],
      since,
    );
    expect([s.total, s.server, s.notFound, s.tooMany]).toEqual([4, 1, 1, 1]);
    expect(s.hours).toBe(3); // окно, которое лог реально покрыл, а не 24
  });

  it("ошибки считаются по статусу и пути без строки запроса: 2 926 ответов одному адресу — одна поломка", () => {
    const many = Array.from({ length: 2926 }, (_, i) =>
      line("209.198.159.136", `09/Nov/2026:${String(i % 24).padStart(2, "0")}:00:00 +0000`, "/exchange-api/book/TAL-USDT/stream", 404),
    );
    const s = summarizeAccessLog([...many, line("5.5.5.5", "09/Nov/2026:10:00:00 +0000", "/klines?symbol=TALUSDT", 404)], since);
    expect(s.faults[0]).toEqual({ status: 404, path: "/exchange-api/book/TAL-USDT/stream", count: 2926 });
    expect(s.faults[1]).toEqual({ status: 404, path: "/klines", count: 1 });
    expect(s.worstClient).toEqual({ ip: "209.198.159.136", count: 2926 });
  });

  it("лог без строк в окне: нули, а не деление на ноль", () => {
    const s = summarizeAccessLog([], since);
    expect([s.total, s.hours, s.faults.length, s.worstClient]).toEqual([0, 0, 0, null]);
  });

  it("не больше трёх поломок в отчёте: сообщение Telegram не резиновое", () => {
    const rows = ["/a", "/b", "/c", "/d", "/e"].flatMap((p, i) =>
      Array.from({ length: 10 - i }, () => line("1.1.1.1", "09/Nov/2026:10:00:00 +0000", p, 500)),
    );
    expect(summarizeAccessLog(rows, since).faults.map((f) => f.path)).toEqual(["/a", "/b", "/c"]);
  });
});

describe("probe, ageWords", () => {
  it("прогон свеж, замолчал или не записал ничего", () => {
    expect(probe("цены", new Date("2026-11-09T21:50:00Z"), 40, NOW)).toEqual({ name: "цены", ageMinutes: 10, maxAgeMinutes: 40, state: "ok" });
    expect(probe("цены", new Date("2026-11-09T21:00:00Z"), 40, NOW).state).toBe("stale");
    expect(probe("цены", new Date("2026-11-09T21:20:00Z"), 40, NOW).state).toBe("ok"); // ровно норма — ещё не тишина
    expect(probe("цены", null, 40, NOW)).toEqual({ name: "цены", ageMinutes: null, maxAgeMinutes: 40, state: "missing" });
  });

  it("возраст словами", () => {
    expect([ageWords(0), ageWords(89), ageWords(90), ageWords(190), ageWords(120), ageWords(null)]).toEqual([
      "0 мин",
      "89 мин",
      "1 ч 30 мин",
      "3 ч 10 мин",
      "2 ч",
      "—",
    ]);
  });
});

const facts = (patch: Partial<HealthFacts> = {}): HealthFacts => ({
  at: NOW,
  probes: [probe("цены монет", new Date("2026-11-09T21:55:00Z"), 40, NOW), probe("новости", new Date("2026-11-09T18:00:00Z"), 120, NOW)],
  cards: { cards: 56, factsErrors: {}, factsStale: 0, supplyErrors: { supply_unsupported: 19 }, mismatched: 0 },
  queue: { cards: 0, points: 0 },
  log: null,
  pages: [{ path: "/en", status: 200, ms: 120 }],
  signups: 3,
  ...patch,
});

describe("renderHealthReport", () => {
  it("замолчавший прогон назван, свежий — нет: молчание и есть хорошая новость", () => {
    const text = renderHealthReport(facts());
    expect(text).toContain("Замолчали прогоны (1 из 2)");
    expect(text).toContain("• новости: тишина 4 ч (норма 2 ч)");
    expect(text).not.toContain("цены монет");
  });

  it("все прогоны свежие — одна строка вместо списка", () => {
    const text = renderHealthReport(facts({ probes: [probe("цены монет", NOW, 40, NOW)] }));
    expect(text).toContain("Прогоны: все 1 свежие.");
  });

  it("страница с ошибкой и страница без ответа названы, живые — нет", () => {
    const text = renderHealthReport(
      facts({ pages: [{ path: "/en", status: 200, ms: 90 }, { path: "/en/coins/bitcoin", status: 500, ms: 300 }, { path: "/api/crypto-map/poi", status: null, ms: 0 }] }),
    );
    expect(text).toContain("• /en/coins/bitcoin: 500 (300 мс)");
    expect(text).toContain("• /api/crypto-map/poi: нет ответа");
    expect(text).not.toContain("• /en:");
  });

  it("доли nginx, поломки и клиент с лавиной ошибок", () => {
    const text = renderHealthReport(
      facts({
        log: {
          hours: 24,
          total: 20_000,
          server: 20,
          tooMany: 9_088,
          notFound: 2_926,
          faults: [{ status: 429, path: "/exchange-api/book/BTC-USDT/stream", count: 6_778 }],
          worstClient: { ip: "31.210.141.139", count: 9_088 },
        },
      }),
    );
    expect(text).toContain("nginx за 24 ч: 20000 запросов, 5xx 0.1%, 429 45.4%, 404 14.6%.");
    expect(text).toContain("• 429 ×6778 /exchange-api/book/BTC-USDT/stream");
    expect(text).toContain("• больше всех ошибок одному клиенту: 9088 (31.210.141.139)");
  });

  it("лог недоступен — так и сказано, остальной отчёт на месте", () => {
    const text = renderHealthReport(facts());
    expect(text).toContain("nginx: лог недоступен");
    expect(text).toContain("Карточки сетей: 56.");
    expect(text).toContain("Ошибки выпуска: supply_unsupported ×19.");
    expect(text).toContain("Ждут модерации: ничего.");
    expect(text).toContain("Новых людей за сутки: 3.");
  });

  it("очередь модерации названа, когда в ней кто-то есть", () => {
    expect(renderHealthReport(facts({ queue: { cards: 2, points: 1 } }))).toContain("Ждут модерации: карточки 2, точки 1.");
  });
});
