import { describe, expect, it } from "vitest";
import {
  PROMO_MIN_GAP_HOURS,
  PROMO_RECEIVES_PER_DAY,
  PROMO_SENDS_PER_DAY,
  companySendGate,
  recipientGate,
  planDeliveries,
} from "@/lib/promos/antispam";

const hour = 60 * 60 * 1000;
const now = new Date("2026-11-19T12:00:00.000Z");

describe("companySendGate", () => {
  it("lets the first send of the day through", () => {
    expect(companySendGate({ sentToday: 0, lastSentAt: null }, now)).toEqual({ ok: true });
  });

  it("refuses once the daily ceiling is spent", () => {
    expect(companySendGate({ sentToday: PROMO_SENDS_PER_DAY, lastSentAt: new Date(now.getTime() - 23 * hour) }, now)).toEqual({
      ok: false,
      reason: "daily_cap",
    });
  });

  // «Одна в сутки» без зазора означает 23:59 и 00:01, то есть две подряд.
  it("keeps a gap even when the calendar day has turned over", () => {
    expect(companySendGate({ sentToday: 0, lastSentAt: new Date(now.getTime() - 2 * hour) }, now)).toEqual({
      ok: false,
      reason: "too_soon",
    });
    expect(companySendGate({ sentToday: 0, lastSentAt: new Date(now.getTime() - (PROMO_MIN_GAP_HOURS + 1) * hour) }, now)).toEqual({
      ok: true,
    });
  });
});

describe("recipientGate", () => {
  const live = { muted: false, notifyPromos: true, receivedToday: 0 };

  it("passes a subscriber who left everything on", () => {
    expect(recipientGate(live)).toBe(null);
  });

  it("names each refusal with its own reason", () => {
    expect(recipientGate({ ...live, muted: true })).toBe("SKIPPED_MUTED");
    expect(recipientGate({ ...live, notifyPromos: false })).toBe("SKIPPED_OFF");
    expect(recipientGate({ ...live, receivedToday: PROMO_RECEIVES_PER_DAY })).toBe("SKIPPED_CAP");
  });

  // Потолок принадлежит человеку, а не магазину: десять магазинов по одной рассылке —
  // это десять сообщений, и ни один из них правила не нарушил.
  it("counts the ceiling across all shops, not per shop", () => {
    expect(recipientGate({ ...live, receivedToday: PROMO_RECEIVES_PER_DAY - 1 })).toBe(null);
    expect(recipientGate({ ...live, receivedToday: PROMO_RECEIVES_PER_DAY + 3 })).toBe("SKIPPED_CAP");
  });

  it("puts the louder refusal first: off beats muted beats cap", () => {
    expect(recipientGate({ muted: true, notifyPromos: false, receivedToday: 99 })).toBe("SKIPPED_OFF");
    expect(recipientGate({ muted: true, notifyPromos: true, receivedToday: 99 })).toBe("SKIPPED_MUTED");
  });
});

describe("planDeliveries", () => {
  const followers = [
    { userId: "a", muted: false, notifyPromos: true, receivedToday: 0 },
    { userId: "b", muted: true, notifyPromos: true, receivedToday: 0 },
    { userId: "c", muted: false, notifyPromos: false, receivedToday: 0 },
    { userId: "d", muted: false, notifyPromos: true, receivedToday: PROMO_RECEIVES_PER_DAY },
  ];

  it("splits subscribers into those to write to and those to skip, with reasons", () => {
    const plan = planDeliveries(followers);
    expect(plan.send).toEqual(["a"]);
    expect(plan.skip).toEqual([
      { userId: "b", outcome: "SKIPPED_MUTED" },
      { userId: "c", outcome: "SKIPPED_OFF" },
      { userId: "d", outcome: "SKIPPED_CAP" },
    ]);
    expect(plan.followers).toBe(4);
  });

  it("is empty-safe: a shop with no subscribers plans nothing", () => {
    expect(planDeliveries([])).toEqual({ followers: 0, send: [], skip: [] });
  });
});
