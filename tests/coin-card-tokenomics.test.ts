import { describe, it, expect } from "vitest";
import {
  ALLOCATION_TOLERANCE_PCT,
  MAX_ALLOCATION_ROWS,
  MAX_UNLOCK_ROWS,
  allocationBars,
  unlockSummary,
  validateAllocation,
  validateUnlocks,
} from "../src/lib/coin-card-tokenomics";

describe("validateAllocation", () => {
  it("сумма ровно сто процентов проходит", () => {
    const got = validateAllocation([
      { label: "Команда", pct: 20, vestingMonths: 24, cliffMonths: 12 },
      { label: "Инвесторы", pct: 30 },
      { label: "Сообщество", pct: 50 },
    ]);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.data).toHaveLength(3);
  });

  it("недобор до ста процентов — не ошибка", () => {
    const got = validateAllocation([{ label: "Команда", pct: 99.7 }]);
    expect(got.ok).toBe(true);
  });

  it("перебор больше допуска — ошибка", () => {
    const got = validateAllocation([
      { label: "Команда", pct: 60 },
      { label: "Инвесторы", pct: 40.6 },
    ]);
    expect(got).toEqual({ ok: false, reason: "allocation_over_100" });
  });

  it("перебор в пределах допуска прощается", () => {
    const got = validateAllocation([
      { label: "Команда", pct: 60 },
      { label: "Инвесторы", pct: 40 + ALLOCATION_TOLERANCE_PCT },
    ]);
    expect(got.ok).toBe(true);
  });

  it("отрицательная и запредельная доля — ошибка", () => {
    expect(validateAllocation([{ label: "Команда", pct: -1 }])).toEqual({
      ok: false,
      reason: "allocation_invalid",
    });
    expect(validateAllocation([{ label: "Команда", pct: 101 }])).toEqual({
      ok: false,
      reason: "allocation_invalid",
    });
  });

  it("строка без подписи — ошибка: безымянная доля ничего не объясняет", () => {
    expect(validateAllocation([{ label: "  ", pct: 10 }])).toEqual({
      ok: false,
      reason: "allocation_invalid",
    });
  });

  it("нечисловая доля — ошибка", () => {
    expect(validateAllocation([{ label: "Команда", pct: "много" as never }])).toEqual({
      ok: false,
      reason: "allocation_invalid",
    });
  });

  it("строк больше лимита — ошибка", () => {
    const rows = Array.from({ length: MAX_ALLOCATION_ROWS + 1 }, (_, i) => ({
      label: `Группа ${i}`,
      pct: 0.5,
    }));
    expect(validateAllocation(rows)).toEqual({ ok: false, reason: "allocation_invalid" });
  });

  it("пустые строки формы отбрасываются, а не ломают проверку", () => {
    const got = validateAllocation([
      { label: "Команда", pct: 20 },
      { label: "", pct: null as never },
    ]);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.data).toHaveLength(1);
  });

  it("клифф и вестинг нормализуются в целые месяцы", () => {
    const got = validateAllocation([
      { label: "Команда", pct: 20, cliffMonths: "12" as never, vestingMonths: 24.4 as never },
    ]);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.data[0]).toEqual({
      label: "Команда",
      pct: 20,
      cliffMonths: 12,
      vestingMonths: 24,
      address: null,
    });
  });
});

describe("allocationBars", () => {
  it("добавляет остаток как нераспределённое", () => {
    const bars = allocationBars([
      { label: "Команда", pct: 20, cliffMonths: null, vestingMonths: null, address: null },
      { label: "Сообщество", pct: 50, cliffMonths: null, vestingMonths: null, address: null },
    ]);
    expect(bars.map((b) => [b.label, b.pct, b.unallocated])).toEqual([
      ["Команда", 20, false],
      ["Сообщество", 50, false],
      [null, 30, true],
    ]);
  });

  it("при полной раздаче остатка нет", () => {
    const bars = allocationBars([
      { label: "Всё", pct: 100, cliffMonths: null, vestingMonths: null, address: null },
    ]);
    expect(bars).toHaveLength(1);
  });

  it("без строк полосы нет вовсе", () => {
    expect(allocationBars([])).toEqual([]);
  });
});

describe("validateUnlocks", () => {
  it("принимает объём в монетах и долю в процентах", () => {
    const got = validateUnlocks([
      { date: "2026-12-01", label: "Команда, транш 1", amount: 1_000_000 },
      { date: "2027-01-01", label: "Инвесторы", pct: 2.5, source: "https://example.com/vesting" },
    ]);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.data).toHaveLength(2);
  });

  it("сортирует по дате", () => {
    const got = validateUnlocks([
      { date: "2027-03-01", label: "Поздний", pct: 1 },
      { date: "2026-12-01", label: "Ранний", pct: 1 },
    ]);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.data.map((r) => r.label)).toEqual(["Ранний", "Поздний"]);
  });

  it("без объёма и без доли — ошибка", () => {
    expect(validateUnlocks([{ date: "2026-12-01", label: "Непонятно" }])).toEqual({
      ok: false,
      reason: "unlock_invalid",
    });
  });

  it("непарсимая дата — ошибка", () => {
    expect(validateUnlocks([{ date: "когда-нибудь", label: "Команда", pct: 1 }])).toEqual({
      ok: false,
      reason: "unlock_invalid",
    });
  });

  it("доля вне диапазона и отрицательный объём — ошибка", () => {
    expect(validateUnlocks([{ date: "2026-12-01", label: "Команда", pct: 101 }])).toEqual({
      ok: false,
      reason: "unlock_invalid",
    });
    expect(validateUnlocks([{ date: "2026-12-01", label: "Команда", amount: -5 }])).toEqual({
      ok: false,
      reason: "unlock_invalid",
    });
  });

  it("строк больше лимита — ошибка", () => {
    const rows = Array.from({ length: MAX_UNLOCK_ROWS + 1 }, () => ({
      date: "2026-12-01",
      label: "Транш",
      pct: 0.1,
    }));
    expect(validateUnlocks(rows)).toEqual({ ok: false, reason: "unlock_invalid" });
  });

  it("пустые строки формы отбрасываются", () => {
    const got = validateUnlocks([
      { date: "2026-12-01", label: "Команда", pct: 1 },
      { date: "", label: "" },
    ]);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.data).toHaveLength(1);
  });

  it("не-http ссылка-источник отклоняет строку, а не теряется молча", () => {
    expect(
      validateUnlocks([
        { date: "2026-12-01", label: "Команда", pct: 1, source: "javascript:alert(1)" },
      ]),
    ).toEqual({ ok: false, reason: "unlock_invalid" });
  });

  it("нормальная ссылка-источник сохраняется", () => {
    const got = validateUnlocks([
      { date: "2026-12-01", label: "Команда", pct: 1, source: "example.com/vesting" },
    ]);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.data[0].source).toBe("https://example.com/vesting");
  });
});

describe("unlockSummary", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  const rows = [
    { date: "2026-10-01", label: "Прошедший", pct: 5, amount: null, source: null },
    { date: "2026-11-20", label: "Через 13 дней", pct: null, amount: 1_000, source: null },
    { date: "2026-12-07", label: "Ровно 30 дней", pct: 2, amount: null, source: null },
    { date: "2027-02-05", label: "Ровно 90 дней", pct: 3, amount: null, source: null },
    { date: "2027-06-01", label: "Далёкий", pct: 10, amount: null, source: null },
  ];

  it("считает доли на окнах 30 и 90 дней включительно", () => {
    const got = unlockSummary(rows, { now, total: "100000" });
    // 1000 монет из 100000 = 1%, плюс 2% на тридцатом дне.
    expect(got.pct30).toBeCloseTo(3, 6);
    expect(got.pct90).toBeCloseTo(6, 6);
  });

  it("прошедшие события считает, но в ближайшие не кладёт", () => {
    const got = unlockSummary(rows, { now, total: "100000" });
    expect(got.pastCount).toBe(1);
    expect(got.next.map((r) => r.label)).toEqual([
      "Через 13 дней",
      "Ровно 30 дней",
      "Ровно 90 дней",
      "Далёкий",
    ]);
  });

  it("разлок сегодня считается будущим", () => {
    const got = unlockSummary(
      [{ date: "2026-11-07", label: "Сегодня", pct: 4, amount: null, source: null }],
      { now, total: "100000" },
    );
    expect(got.pastCount).toBe(0);
    expect(got.pct30).toBeCloseTo(4, 6);
  });

  it("без общего выпуска объёмы в монетах в проценты не превращаются", () => {
    const got = unlockSummary(
      [{ date: "2026-11-20", label: "Транш", pct: null, amount: 1_000, source: null }],
      { now, total: null },
    );
    expect(got.pct30).toBeNull();
    expect(got.next).toHaveLength(1);
  });

  it("показывает не больше пяти ближайших", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      date: `2026-12-0${i + 1}`,
      label: `Транш ${i + 1}`,
      pct: 1,
      amount: null,
      source: null,
    }));
    const got = unlockSummary(many, { now, total: "100000" });
    expect(got.next).toHaveLength(5);
    expect(got.upcomingCount).toBe(9);
  });

  it("пустой список — пустая сводка", () => {
    const got = unlockSummary([], { now, total: "100000" });
    expect(got).toEqual({ next: [], pct30: 0, pct90: 0, pastCount: 0, upcomingCount: 0 });
  });
});
