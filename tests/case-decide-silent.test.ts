import { describe, expect, it, vi, beforeEach } from "vitest";

const calls: Record<string, unknown[]> = {};
function spy(name: string) {
  return vi.fn(async (...args: unknown[]) => {
    calls[name] = args;
    return { ok: true };
  });
}

vi.mock("@/app/actions/admin-coin-cards", () => ({
  approveCoinCard: spy("approveCoinCard"),
  rejectCoinCard: spy("rejectCoinCard"),
}));
vi.mock("@/app/actions/admin-company", () => ({
  approveCompany: spy("approveCompany"),
  rejectCompany: spy("rejectCompany"),
}));
vi.mock("@/app/actions/admin-points", () => ({
  approvePoint: spy("approvePoint"),
  rejectPoint: spy("rejectPoint"),
}));
vi.mock("@/app/actions/admin-exchange", () => ({
  approveExchange: spy("approveExchange"),
  rejectExchange: spy("rejectExchange"),
}));
vi.mock("@/app/actions/admin-fintech", () => ({
  approveFintech: spy("approveFintech"),
  rejectFintech: spy("rejectFintech"),
}));
vi.mock("@/app/actions/admin-requests", () => ({
  approveRequest: spy("approveRequest"),
  rejectRequest: spy("rejectRequest"),
}));
vi.mock("@/app/actions/kyb", () => ({
  approveKyb: spy("approveKyb"),
  rejectKyb: spy("rejectKyb"),
}));
vi.mock("@/app/actions/point-supervision", () => ({
  suspendPoint: spy("suspendPoint"),
  clearPointReview: spy("clearPointReview"),
}));

const { applyDecision } = await import("@/lib/cases/decide");

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
});

describe("applyDecision и молчаливый отказ", () => {
  it("закрытие спама не пишет заявителю: silent доходит до экшена", async () => {
    await applyDecision({
      subjectType: "EXCHANGE",
      subjectId: "e1",
      decision: "REJECTED",
      reason: "боты",
      silent: true,
    });
    expect(calls.rejectExchange?.[0]).toEqual({
      exchangeId: "e1",
      rejectionReason: "боты",
      silent: true,
    });
  });

  it("обычный отказ заявителю пишет: silent выключен по умолчанию", async () => {
    await applyDecision({
      subjectType: "FINTECH",
      subjectId: "f1",
      decision: "REJECTED",
      reason: "нет лицензии",
    });
    expect(calls.rejectFintech?.[0]).toEqual({
      id: "f1",
      rejectionReason: "нет лицензии",
      silent: false,
    });
  });

  it("одобрение флага не получает — молчаливых одобрений не бывает", async () => {
    await applyDecision({
      subjectType: "COMPANY",
      subjectId: "c1",
      decision: "APPROVED",
      reason: "",
      silent: true,
    });
    expect(calls.approveCompany?.[0]).toEqual({ companyId: "c1" });
  });
});
