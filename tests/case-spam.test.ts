import { describe, expect, it } from "vitest";
import {
  isSpamClosable,
  spamBlockers,
  SPAM_BATCH_MAX,
  SPAM_CLOSABLE,
} from "@/lib/cases/spam";
import { QUEUES } from "@/lib/cases/queues";

const OK = { caseIds: ["a"], reason: "боты с мусорными именами", subjectTypes: ["EXCHANGE" as const] };

describe("spamBlockers", () => {
  it("годная пачка проходит", () => {
    expect(spamBlockers(OK)).toEqual([]);
  });

  it("пустой выбор не закрывает ничего", () => {
    expect(spamBlockers({ ...OK, caseIds: [] })).toContain("empty");
  });

  it("пачка больше предела отвергается целиком", () => {
    const ids = Array.from({ length: SPAM_BATCH_MAX + 1 }, (_, i) => `c${i}`);
    expect(spamBlockers({ ...OK, caseIds: ids })).toContain("too_many");
  });

  it("причина обязательна", () => {
    expect(spamBlockers({ ...OK, reason: "  " })).toContain("reason_too_short");
    expect(spamBlockers({ ...OK, reason: "ок" })).toContain("reason_too_short");
  });

  it("KYB спамом не закрывается: документы подаёт заведённое предприятие", () => {
    expect(isSpamClosable("KYB")).toBe(false);
    expect(spamBlockers({ ...OK, subjectTypes: ["KYB"] })).toContain("not_spam_closable");
  });

  it("жалоба на точку спамом не закрывается: у её решения свои слова", () => {
    expect(isSpamClosable("POINT_REPORT")).toBe(false);
  });

  it("заявка с улицы закрывается", () => {
    for (const t of ["COIN_CARD", "COMPANY", "POINT", "EXCHANGE", "FINTECH", "COIN_REQUEST"] as const) {
      expect(isSpamClosable(t)).toBe(true);
    }
  });

  it("в списке нет типа, которого нет ни в одной очереди", () => {
    const known = new Set(QUEUES.flatMap((q) => q.subjectTypes));
    for (const t of SPAM_CLOSABLE) expect(known.has(t)).toBe(true);
  });
});
