import type { CaseActorSide, CaseEventKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Журнал дела — только вставка. Ни одного update/delete по CaseEvent в проекте
 * быть не должно: это и есть «неизменяемый».
 */
export async function appendCaseEvent(input: {
  caseId: string;
  actorId?: string | null;
  actorSide?: CaseActorSide;
  kind: CaseEventKind;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.caseEvent.create({
      data: {
        caseId: input.caseId,
        actorId: input.actorId ?? null,
        actorSide: input.actorSide ?? "STAFF",
        kind: input.kind,
        payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    // Журнал не должен ронять само действие — ровно как logAdminAction.
    console.error("[case-journal] failed to append:", err);
  }
}

const KEYS: Record<CaseEventKind, string> = {
  OPENED: "opened",
  CLAIMED: "claimed",
  RELEASED: "released",
  STATUS_CHANGED: "statusChanged",
  CLOCK_PAUSED: "clockPaused",
  CLOCK_RESUMED: "clockResumed",
  TIME_ADJUSTED: "timeAdjusted",
  NOTE: "note",
  MESSAGE_SENT: "messageSent",
  MESSAGE_RECEIVED: "messageReceived",
  REVIEWED: "reviewed",
  CHECK_SET: "checkSet",
  DOCUMENT_VERDICT: "documentVerdict",
  DECIDED: "decided",
};

/** Событие → ключ перевода `admin.case.journal.<key>` и его параметры. */
export function describeEvent(event: {
  kind: CaseEventKind;
  payload: unknown;
}): { key: string; params: Record<string, string | number> } {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "string" || typeof v === "number") params[k] = v;
  }
  return { key: KEYS[event.kind] ?? "note", params };
}
