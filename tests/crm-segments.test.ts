import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import {
  CRM_SEGMENTS,
  DORMANT_DAYS,
  REGULAR_PURCHASES,
  customerLabel,
  inSegment,
  reachable,
  segmentCounts,
  segmentsFor,
  type CustomerFacts,
} from "@/lib/crm/segments";

const NOW = new Date("2026-11-26T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 3600 * 1000);

function person(over: Partial<CustomerFacts> = {}): CustomerFacts {
  return {
    userId: "u1",
    username: "pavel",
    name: null,
    follows: false,
    muted: false,
    notifyPromos: true,
    purchases: 0,
    purchasesInWindow: 0,
    cancelled: 0,
    firstPurchaseAt: null,
    lastPurchaseAt: null,
    lastMessageAt: null,
    turnover: {},
    cashback: {},
    ...over,
  };
}

describe("сегменты покупателей (слайс CN)", () => {
  it("покупателем считается тот, у кого есть привязанный чек", () => {
    expect(inSegment(person(), "buyers", NOW)).toBe(false);
    expect(inSegment(person({ purchases: 1, lastPurchaseAt: daysAgo(1) }), "buyers", NOW)).toBe(true);
  });

  it("постоянство считается по окну, а не по всей жизни", () => {
    const old = person({ purchases: 9, purchasesInWindow: 0, lastPurchaseAt: daysAgo(400) });
    expect(inSegment(old, "regulars", NOW)).toBe(false);
    const live = person({ purchases: 9, purchasesInWindow: REGULAR_PURCHASES, lastPurchaseAt: daysAgo(3) });
    expect(inSegment(live, "regulars", NOW)).toBe(true);
  });

  it("новый — тот, у кого покупка пока одна и она свежая", () => {
    expect(inSegment(person({ purchases: 1, lastPurchaseAt: daysAgo(3) }), "newcomers", NOW)).toBe(true);
    // Одна покупка год назад — это не новый покупатель, а спящий.
    const stale = person({ purchases: 1, lastPurchaseAt: daysAgo(365) });
    expect(inSegment(stale, "newcomers", NOW)).toBe(false);
    expect(inSegment(stale, "dormant", NOW)).toBe(true);
  });

  it("спящим считается только тот, кто покупал: подписчик без покупок не спит", () => {
    const follower = person({ follows: true });
    expect(inSegment(follower, "dormant", NOW)).toBe(false);
    expect(inSegment(follower, "followersNoPurchase", NOW)).toBe(true);
    // Граница ровно на числе ТЗ: день до порога ещё не спящий.
    expect(inSegment(person({ purchases: 2, lastPurchaseAt: daysAgo(DORMANT_DAYS - 1) }), "dormant", NOW)).toBe(false);
    expect(inSegment(person({ purchases: 2, lastPurchaseAt: daysAgo(DORMANT_DAYS + 1) }), "dormant", NOW)).toBe(true);
  });

  it("сегменты пересекаются — это признаки, а не состояния", () => {
    const both = person({ purchases: 5, purchasesInWindow: 3, lastPurchaseAt: daysAgo(DORMANT_DAYS + 5) });
    expect(segmentsFor(both, NOW)).toEqual(expect.arrayContaining(["buyers", "regulars", "dormant"]));
  });

  it("написать можно только подписчику: покупка согласием на рекламу не является", () => {
    const buyer = person({ purchases: 3, lastPurchaseAt: daysAgo(1) });
    expect(reachable(buyer)).toBe(false);
    expect(reachable({ ...buyer, follows: true })).toBe(true);
    expect(reachable({ ...buyer, follows: true, muted: true })).toBe(false);
    expect(reachable({ ...buyer, follows: true, notifyPromos: false })).toBe(false);
  });

  it("в числах сегмента охват считается отдельно от размера", () => {
    const list = [
      person({ userId: "a", purchases: 1, lastPurchaseAt: daysAgo(200), follows: true }),
      person({ userId: "b", purchases: 1, lastPurchaseAt: daysAgo(200) }),
    ];
    const counts = segmentCounts(list, NOW);
    expect(counts.dormant).toEqual({ total: 2, reachable: 1 });
  });

  it("человек подписан именем входа, а не почтой", () => {
    expect(customerLabel({ username: "pavel", name: "Pavel P" })).toBe("@pavel");
    expect(customerLabel({ username: null, name: "Pavel P" })).toBe("Pavel P");
    expect(customerLabel({ username: null, name: null })).toBe("—");
  });

  it("у каждого сегмента есть слова на обоих экранах", () => {
    const crm = (en as Record<string, any>).cabinetCrm.segment as Record<string, string>;
    const promos = (en as Record<string, any>).cabinetPromos.segment as Record<string, string>;
    for (const key of CRM_SEGMENTS) {
      expect(crm[key], `cabinetCrm.segment.${key}`).toBeTruthy();
      expect(promos[key], `cabinetPromos.segment.${key}`).toBeTruthy();
    }
    expect(Object.keys(crm).filter((k) => !CRM_SEGMENTS.includes(k as never))).toEqual([]);
    expect(Object.keys(promos).filter((k) => !CRM_SEGMENTS.includes(k as never))).toEqual([]);
  });
});
