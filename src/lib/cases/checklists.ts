import type { CaseCheckState, CaseSubjectType } from "@prisma/client";

export type { CaseCheckState };

export type CheckDef = {
  /** Ключ пункта. Подпись — `admin.case.checks.<key>` в messages. */
  key: string;
  /** Обязательный пункт нельзя оставить без ответа перед одобрением. */
  required: boolean;
};

/**
 * Листы проверок по типу заявки. Список живёт в коде, а не строками в базе:
 * заведи строки при открытии дела — и список замрёт на том виде, в каком был в
 * день подачи, а новый пункт не появится у уже открытых дел.
 *
 * Ключи нарочно переиспользуются между типами (websiteLive, sanctionsScreened,
 * noMisleadingClaims): одна подпись на один вопрос, а не семь переводов одного
 * и того же.
 */
export const CHECKLISTS: Record<CaseSubjectType, CheckDef[]> = {
  COMPANY: [
    { key: "legalNameMatchesRegistry", required: true },
    { key: "addressPlausible", required: true },
    { key: "websiteLive", required: true },
    { key: "sanctionsScreened", required: true },
    { key: "contactReachable", required: false },
  ],
  KYB: [
    { key: "registrationCert", required: true },
    { key: "documentsLegible", required: true },
    { key: "signatoryIdentified", required: true },
    { key: "sanctionsScreened", required: true },
    { key: "taxCert", required: false },
    { key: "uboDisclosed", required: false },
  ],
  POINT: [
    { key: "coordsOnSite", required: true },
    { key: "addressMatchesCoords", required: true },
    { key: "acceptsCryptoEvidence", required: true },
    { key: "photoRelevant", required: false },
  ],
  COIN_CARD: [
    { key: "contractsVerified", required: true },
    { key: "linksLive", required: true },
    { key: "noMisleadingClaims", required: true },
    { key: "supplyPlausible", required: false },
    { key: "teamDisclosed", required: false },
  ],
  COIN_REQUEST: [
    { key: "coinExists", required: true },
    { key: "coingeckoIdMatches", required: true },
    { key: "notDuplicate", required: true },
  ],
  EXCHANGE: [
    { key: "websiteLive", required: true },
    { key: "legalEntityStated", required: true },
    { key: "noMisleadingClaims", required: true },
    { key: "contactReachable", required: false },
  ],
  FINTECH: [
    { key: "websiteLive", required: true },
    { key: "servicesMatchSite", required: true },
    { key: "noMisleadingClaims", required: true },
    { key: "availabilityPlausible", required: false },
  ],
  POINT_REPORT: [
    { key: "reportsIndependent", required: true },
    { key: "ownerAsked", required: true },
    { key: "pointStillListed", required: false },
  ],
};

export function checklistFor(subjectType: CaseSubjectType): CheckDef[] {
  return CHECKLISTS[subjectType] ?? [];
}

/** Состояния, которые считаются ответом по пункту. TODO — ответа нет. */
export const ANSWERED: CaseCheckState[] = ["OK", "FAIL", "NA"];

/** Примечание обязательно там, где ответ сам по себе ничего не объясняет. */
export function noteRequired(state: CaseCheckState): boolean {
  return state === "FAIL" || state === "NA";
}

export type ChecklistProgress = {
  total: number;
  required: number;
  answered: number;
  requiredAnswered: number;
  /** Сколько обязательных пунктов ждёт ответа — это и есть препятствие. */
  requiredPending: number;
  failed: number;
};

export function checklistProgress(
  subjectType: CaseSubjectType,
  rows: { key: string; state: CaseCheckState }[],
): ChecklistProgress {
  const defs = checklistFor(subjectType);
  const byKey = new Map(rows.map((r) => [r.key, r.state]));
  let answered = 0;
  let requiredAnswered = 0;
  let failed = 0;
  for (const def of defs) {
    const state = byKey.get(def.key) ?? "TODO";
    if (ANSWERED.includes(state)) {
      answered += 1;
      if (def.required) requiredAnswered += 1;
    }
    if (state === "FAIL") failed += 1;
  }
  const required = defs.filter((d) => d.required).length;
  return {
    total: defs.length,
    required,
    answered,
    requiredAnswered,
    requiredPending: required - requiredAnswered,
    failed,
  };
}
