/**
 * Карта «экран или действие → требование». Нужна полноте: по ней видно, что ни
 * один экран админки не остался без охранника, и ею же сверяется, что у
 * требования есть место применения (тот же приём, что у листов проверок в AP).
 */
import type { CaseSubjectType } from "@prisma/client";
import type { StaffLevel } from "@/lib/authz/policy";
import { QUEUES, type QueueKey } from "@/lib/cases/queues";

export type Requirement = {
  key: string;
  /** `staff` — общая калитка в админку; `owner` — не дело, а управление системой. */
  need: StaffLevel | "staff" | "owner";
  queues: QueueKey[];
};

export const ALL_QUEUES: QueueKey[] = QUEUES.map((q) => q.key);

/**
 * Очередь объекта по типу дела. У жалобы на точку решение снимает или
 * возвращает саму точку, поэтому вести её вправе и тот, кому выдали `points`, и
 * тот, кому выдали `pointReports`: обе очереди про один объект.
 */
export const SUBJECT_QUEUES: Record<CaseSubjectType, QueueKey[]> = {
  COIN_CARD: ["coinCards"],
  COMPANY: ["companies"],
  POINT: ["points"],
  EXCHANGE: ["exchanges"],
  FINTECH: ["fintech"],
  KYB: ["kyb"],
  COIN_REQUEST: ["coinRequests"],
  POINT_REPORT: ["points", "pointReports"],
};

export const ACCESS_MAP: Requirement[] = [
  { key: "adminRoot", need: "staff", queues: [] },
  { key: "adminQueues", need: "staff", queues: [] },
  { key: "adminNotifications", need: "staff", queues: [] },
  { key: "caseHeartbeat", need: "staff", queues: [] },
  { key: "releaseCase", need: "staff", queues: [] },

  { key: "queueList", need: "VIEW", queues: ALL_QUEUES },
  { key: "casePage", need: "VIEW", queues: ALL_QUEUES },
  { key: "claimCase", need: "HANDLE", queues: ALL_QUEUES },
  { key: "adjustCaseTime", need: "HANDLE", queues: ALL_QUEUES },
  { key: "sendStaffMessage", need: "HANDLE", queues: ALL_QUEUES },
  { key: "setCaseCheck", need: "HANDLE", queues: ALL_QUEUES },
  { key: "setDocumentVerdict", need: "HANDLE", queues: ALL_QUEUES },
  { key: "markReviewed", need: "HANDLE", queues: ALL_QUEUES },
  { key: "decideCase", need: "APPROVE", queues: ALL_QUEUES },
  // Закрытие спама пачкой — то же право, что решение: оно отвергает заявки.
  // Очереди все, а какие типы дел так закрывать можно — в `cases/spam.ts`.
  { key: "closeCasesAsSpam", need: "APPROVE", queues: ALL_QUEUES },

  { key: "coinCardDecision", need: "APPROVE", queues: ["coinCards"] },
  { key: "coinCardRevisions", need: "APPROVE", queues: ["coinCards"] },
  { key: "companyDecision", need: "APPROVE", queues: ["companies"] },
  { key: "companySupervision", need: "APPROVE", queues: ["companies"] },
  { key: "kybDecision", need: "APPROVE", queues: ["kyb"] },
  { key: "pointDecision", need: "APPROVE", queues: ["points"] },
  { key: "pointSupervision", need: "APPROVE", queues: ["points", "pointReports"] },
  { key: "exchangeDecision", need: "APPROVE", queues: ["exchanges"] },
  { key: "fintechDecision", need: "APPROVE", queues: ["fintech"] },
  { key: "coinRequestDecision", need: "APPROVE", queues: ["coinRequests"] },

  { key: "adminHistoryCoinCards", need: "VIEW", queues: ["coinCards"] },
  { key: "adminHistoryBusiness", need: "VIEW", queues: ["companies", "points", "kyb"] },
  { key: "adminHistoryExchanges", need: "VIEW", queues: ["exchanges"] },
  { key: "adminHistoryFintech", need: "VIEW", queues: ["fintech"] },
  { key: "adminHistoryRequests", need: "VIEW", queues: ["coinRequests"] },
  { key: "adminCompanyCard", need: "VIEW", queues: ["companies"] },

  { key: "adminStaff", need: "owner", queues: [] },
  { key: "staffAccess", need: "owner", queues: [] },
  { key: "staffInvites", need: "owner", queues: [] },
  { key: "adminUsers", need: "owner", queues: [] },
  { key: "adminAudit", need: "owner", queues: [] },
  { key: "adminAnalytics", need: "owner", queues: [] },
  { key: "adminCoins", need: "owner", queues: [] },
];

export function requirementFor(key: string): Requirement | null {
  return ACCESS_MAP.find((r) => r.key === key) ?? null;
}
