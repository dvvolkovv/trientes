/**
 * Слайс E: аллокация по долям и календарь разлоков.
 *
 * Два правила, которые здесь не рекомендации:
 *  - доля без подписи не сохраняется: «20%» без ответа «кому» ничего не
 *    объясняет, а именно это число читатель и хочет понять;
 *  - разлок без объёма (в монетах или в процентах) не событие, а примечание;
 *    такие строки не принимаются.
 *
 * Недобор до ста процентов ошибкой не считается — остаток честно рисуется как
 * «не распределено». Перебор считается: сумма больше ста процентов означает,
 * что раздали больше, чем есть.
 */

import { normalizeHttpUrl } from "@/lib/coin-card-validate";
import { coinsToNumber } from "@/lib/coin-card-supply";

export const MAX_ALLOCATION_ROWS = 20;
export const MAX_UNLOCK_ROWS = 50;
/** Допуск на округления проекта: 99.9 + 0.2 — не повод отклонять таблицу. */
export const ALLOCATION_TOLERANCE_PCT = 0.5;

export type AllocationInput = {
  label?: string | null;
  pct?: number | null;
  cliffMonths?: number | null;
  vestingMonths?: number | null;
  address?: string | null;
};

export type AllocationRow = {
  label: string;
  pct: number;
  cliffMonths: number | null;
  vestingMonths: number | null;
  address: string | null;
};

export type UnlockInput = {
  date?: string | null;
  label?: string | null;
  amount?: number | null;
  pct?: number | null;
  source?: string | null;
};

export type UnlockRow = {
  date: string;
  label: string;
  /** Объём в монетах; null — задана только доля. */
  amount: number | null;
  /** Доля общего выпуска в процентах; null — задан только объём. */
  pct: number | null;
  source: string | null;
};

export type TokenomicsRowsResult<T> =
  | { ok: true; data: T[] }
  | { ok: false; reason: "allocation_over_100" | "allocation_invalid" | "unlock_invalid" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function text(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

/** Строка формы, в которой не заполнено ничего, — не ошибка, а пустая строка. */
function isBlank(row: Record<string, unknown>): boolean {
  return Object.values(row).every(
    (v) => v == null || (typeof v === "string" && v.trim().length === 0),
  );
}

function num(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const n = Number(raw.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function months(raw: unknown): number | null {
  const n = num(raw);
  if (n == null || n < 0 || n > 600) return null;
  return Math.trunc(n);
}

export function validateAllocation(
  rows: readonly AllocationInput[] | null | undefined,
): TokenomicsRowsResult<AllocationRow> {
  const input = Array.isArray(rows) ? rows : [];
  const out: AllocationRow[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (isBlank(row)) continue;

    const label = text(row.label);
    const pct = num(row.pct);
    if (!label || pct == null || pct < 0 || pct > 100) {
      return { ok: false, reason: "allocation_invalid" };
    }
    out.push({
      label,
      pct,
      cliffMonths: months(row.cliffMonths),
      vestingMonths: months(row.vestingMonths),
      address: text(row.address),
    });
  }

  if (out.length > MAX_ALLOCATION_ROWS) return { ok: false, reason: "allocation_invalid" };

  const sum = out.reduce((s, r) => s + r.pct, 0);
  if (sum > 100 + ALLOCATION_TOLERANCE_PCT) return { ok: false, reason: "allocation_over_100" };

  return { ok: true, data: out };
}

export type AllocationBar = {
  label: string | null;
  pct: number;
  cliffMonths: number | null;
  vestingMonths: number | null;
  /** Остаток до ста процентов. Прятать его нельзя: это тоже информация. */
  unallocated: boolean;
};

export function allocationBars(rows: readonly AllocationRow[]): AllocationBar[] {
  if (rows.length === 0) return [];
  const bars: AllocationBar[] = rows.map((r) => ({
    label: r.label,
    pct: r.pct,
    cliffMonths: r.cliffMonths,
    vestingMonths: r.vestingMonths,
    unallocated: false,
  }));
  const rest = 100 - rows.reduce((s, r) => s + r.pct, 0);
  if (rest > ALLOCATION_TOLERANCE_PCT) {
    bars.push({ label: null, pct: rest, cliffMonths: null, vestingMonths: null, unallocated: true });
  }
  return bars;
}

export function validateUnlocks(
  rows: readonly UnlockInput[] | null | undefined,
): TokenomicsRowsResult<UnlockRow> {
  const input = Array.isArray(rows) ? rows : [];
  const out: UnlockRow[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (isBlank(row)) continue;

    const date = text(row.date);
    const label = text(row.label);
    const amount = num(row.amount);
    const pct = num(row.pct);

    if (!date || !label) return { ok: false, reason: "unlock_invalid" };
    const iso = date.slice(0, 10);
    if (!ISO_DATE.test(iso) || Number.isNaN(Date.parse(iso))) {
      return { ok: false, reason: "unlock_invalid" };
    }
    if (amount == null && pct == null) return { ok: false, reason: "unlock_invalid" };
    if (amount != null && amount < 0) return { ok: false, reason: "unlock_invalid" };
    if (pct != null && (pct < 0 || pct > 100)) return { ok: false, reason: "unlock_invalid" };

    // Битая или не-http ссылка — ошибка, а не молчаливая потеря источника:
    // проект должен узнать, что его ссылку не приняли.
    const source = row.source ? normalizeHttpUrl(String(row.source)) : null;
    if (source === "invalid") return { ok: false, reason: "unlock_invalid" };

    out.push({ date: iso, label, amount, pct, source });
  }

  if (out.length > MAX_UNLOCK_ROWS) return { ok: false, reason: "unlock_invalid" };

  out.sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, data: out };
}

export type UnlockSummary = {
  /** Ближайшие пять событий — остальные прячутся за счётчиком. */
  next: UnlockRow[];
  /** Доля выпуска, разлочиваемая в ближайшие 30 дней; null — посчитать нечем. */
  pct30: number | null;
  pct90: number | null;
  pastCount: number;
  upcomingCount: number;
};

/**
 * Сводка по календарю. Разлок, назначенный на сегодня, считается будущим:
 * день ещё не кончился, и прятать его в «прошедшие» нельзя.
 *
 * Объём в монетах переводится в проценты по общему выпуску. Выпуска нет →
 * процент не выдумывается, возвращается null.
 */
export function unlockSummary(
  rows: readonly UnlockRow[],
  opts: { now: Date; total: string | null },
): UnlockSummary {
  const today = opts.now.toISOString().slice(0, 10);
  const total = coinsToNumber(opts.total);

  const past = rows.filter((r) => r.date < today);
  const upcoming = rows.filter((r) => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));

  const windowPct = (days: number): number | null => {
    const edge = new Date(opts.now.getTime() + days * DAY_MS).toISOString().slice(0, 10);
    let sum = 0;
    for (const r of upcoming) {
      if (r.date > edge) continue;
      if (r.pct != null) sum += r.pct;
      else if (r.amount != null && total != null && total > 0) sum += (r.amount / total) * 100;
      else if (r.amount != null) return null; // объём есть, а выпуска нет — считать нечем
    }
    return sum;
  };

  return {
    next: upcoming.slice(0, 5),
    pct30: windowPct(30),
    pct90: windowPct(90),
    pastCount: past.length,
    upcomingCount: upcoming.length,
  };
}
