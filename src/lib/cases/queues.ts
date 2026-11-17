import { slaState } from "./sla";
import { isOpen, type CaseStatus, type CaseSubjectType, type SlaState } from "./types";

export type QueueKey =
  | "coinCards"
  | "companies"
  | "points"
  | "exchanges"
  | "fintech"
  | "kyb"
  | "coinRequests"
  | "pointReports";

export type QueueDef = {
  key: QueueKey;
  subjectTypes: CaseSubjectType[];
  /** Знак на плитке. Один символ: растры и svg чужих хостов тут не нужны. */
  icon: string;
};

export const QUEUES: QueueDef[] = [
  { key: "coinCards", subjectTypes: ["COIN_CARD"], icon: "🪙" },
  { key: "companies", subjectTypes: ["COMPANY"], icon: "🏢" },
  { key: "points", subjectTypes: ["POINT"], icon: "📍" },
  { key: "exchanges", subjectTypes: ["EXCHANGE"], icon: "🏦" },
  { key: "fintech", subjectTypes: ["FINTECH"], icon: "💳" },
  { key: "kyb", subjectTypes: ["KYB"], icon: "🛡️" },
  { key: "coinRequests", subjectTypes: ["COIN_REQUEST"], icon: "📝" },
  { key: "pointReports", subjectTypes: ["POINT_REPORT"], icon: "⚠️" },
];

export function queueOfSubject(subjectType: CaseSubjectType): QueueDef | null {
  return QUEUES.find((q) => q.subjectTypes.includes(subjectType)) ?? null;
}

export function queueByKey(key: string): QueueDef | null {
  return QUEUES.find((q) => q.key === key) ?? null;
}

export type CaseRow = {
  subjectType: CaseSubjectType;
  status: CaseStatus;
  openedAt: Date;
  dueAt: Date;
  slaSeconds: number;
  clockStoppedAt: Date | null;
};

export type QueueTile = {
  key: QueueKey;
  icon: string;
  open: number;
  oldestOpenedAt: Date | null;
  worst: SlaState | null;
};

const SEVERITY: Record<SlaState, number> = { ok: 0, paused: 1, warn: 2, late: 3 };

export function buildTiles(rows: CaseRow[], now: Date): QueueTile[] {
  return QUEUES.map((q) => {
    const mine = rows.filter((r) => q.subjectTypes.includes(r.subjectType) && isOpen(r.status));
    let oldest: Date | null = null;
    let worst: SlaState | null = null;
    for (const r of mine) {
      if (!oldest || r.openedAt < oldest) oldest = r.openedAt;
      const { state } = slaState({
        now,
        dueAt: r.dueAt,
        slaSeconds: r.slaSeconds,
        clockStoppedAt: r.clockStoppedAt,
      });
      if (!worst || SEVERITY[state] > SEVERITY[worst]) worst = state;
    }
    return { key: q.key, icon: q.icon, open: mine.length, oldestOpenedAt: oldest, worst };
  });
}
