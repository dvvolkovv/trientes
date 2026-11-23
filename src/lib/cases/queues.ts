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
  | "pointReports"
  | "products"
  | "ads";

export type QueueDef = {
  key: QueueKey;
  subjectTypes: CaseSubjectType[];
  /** Знак на плитке. Один символ: растры и svg чужих хостов тут не нужны. */
  icon: string;
};

export const QUEUES: QueueDef[] = [
  { key: "coinCards", subjectTypes: ["COIN_CARD"], icon: "🪙" },
  // Листинг предприятия и правка его карточки — одна работа и один проверяющий,
  // поэтому одна плитка и одно право (прецедент: `products` держит два типа дел).
  { key: "companies", subjectTypes: ["COMPANY", "COMPANY_REVISION"], icon: "🏢" },
  { key: "points", subjectTypes: ["POINT"], icon: "📍" },
  { key: "exchanges", subjectTypes: ["EXCHANGE"], icon: "🏦" },
  { key: "fintech", subjectTypes: ["FINTECH"], icon: "💳" },
  { key: "kyb", subjectTypes: ["KYB"], icon: "🛡️" },
  { key: "coinRequests", subjectTypes: ["COIN_REQUEST"], icon: "📝" },
  { key: "pointReports", subjectTypes: ["POINT_REPORT"], icon: "⚠️" },
  // Одна очередь на два типа дел: заявка производителя и жалоба на паспорт — про один
  // объект, и разводить их по двум плиткам значило бы делить одну работу.
  { key: "products", subjectTypes: ["PRODUCT_CLAIM", "PRODUCT_REPORT"], icon: "📦" },
  // Реклама — своя плитка, а не строка внутри `companies` (слайс CC): посмотреть
  // ролик и послушать озвучку это отдельная работа, и её можно поручить человеку,
  // которому незачем видеть KYB-документы и реквизиты (мотив AS).
  { key: "ads", subjectTypes: ["COMPANY_AD"], icon: "📣" },
];

export function queueOfSubject(subjectType: CaseSubjectType): QueueDef | null {
  return QUEUES.find((q) => q.subjectTypes.includes(subjectType)) ?? null;
}

export function queueByKey(key: string): QueueDef | null {
  return QUEUES.find((q) => q.key === key) ?? null;
}

export type CaseRow = {
  /** Нужен, чтобы сопоставить дело с числом непрочитанного. */
  id: string;
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
  /** Сообщений заявителей, которых не читала ни одна смена. */
  unread: number;
};

const SEVERITY: Record<SlaState, number> = { ok: 0, paused: 1, warn: 2, late: 3 };

export function buildTiles(
  rows: CaseRow[],
  now: Date,
  unreadByCase?: Map<string, number>,
): QueueTile[] {
  return QUEUES.map((q) => {
    const mine = rows.filter((r) => q.subjectTypes.includes(r.subjectType) && isOpen(r.status));
    let oldest: Date | null = null;
    let worst: SlaState | null = null;
    let unread = 0;
    for (const r of mine) {
      if (!oldest || r.openedAt < oldest) oldest = r.openedAt;
      unread += unreadByCase?.get(r.id) ?? 0;
      const { state } = slaState({
        now,
        dueAt: r.dueAt,
        slaSeconds: r.slaSeconds,
        clockStoppedAt: r.clockStoppedAt,
      });
      if (!worst || SEVERITY[state] > SEVERITY[worst]) worst = state;
    }
    return { key: q.key, icon: q.icon, open: mine.length, oldestOpenedAt: oldest, worst, unread };
  });
}
