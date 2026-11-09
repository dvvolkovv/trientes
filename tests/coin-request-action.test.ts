import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  sendEmail: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { coinRequest: { count: m.count, create: m.create } },
}));
vi.mock("@/lib/email", () => ({ sendEmail: m.sendEmail }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));

import { submitCoinRequest } from "@/app/actions/coin-request";

const INPUT = {
  name: "Taler",
  symbol: "tlr",
  coingeckoId: "Taler",
  reason: "Native coin of the Taler network",
};

const CREATED = {
  id: "req_1",
  userId: "user_1",
  name: "Taler",
  symbol: "TLR",
  coingeckoId: "taler",
  reason: "Native coin of the Taler network",
  createdAt: new Date("2026-11-09T08:00:00.000Z"),
  user: { email: "owner@example.com", username: "owner" },
};

describe("submitCoinRequest", () => {
  beforeEach(() => {
    m.auth.mockReset().mockResolvedValue({ user: { id: "user_1" } });
    m.count.mockReset().mockResolvedValue(0);
    m.create.mockReset().mockResolvedValue(CREATED);
    m.sendEmail.mockReset().mockResolvedValue({ ok: true });
    m.revalidatePath.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses anonymous users without touching the DB or mail", async () => {
    m.auth.mockResolvedValue(null);

    await expect(submitCoinRequest(INPUT)).resolves.toEqual({ ok: false, reason: "unauth" });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("stores the request and mails the listing desk", async () => {
    await expect(submitCoinRequest(INPUT)).resolves.toEqual({ ok: true });

    expect(m.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        name: "Taler",
        symbol: "TLR",
        coingeckoId: "taler",
        reason: "Native coin of the Taler network",
      },
      include: { user: { select: { email: true, username: true } } },
    });
    expect(m.revalidatePath).toHaveBeenCalledWith("/", "layout");

    await vi.waitFor(() => expect(m.sendEmail).toHaveBeenCalledTimes(1));
    const mail = m.sendEmail.mock.calls[0]![0];
    expect(mail.to).toBe("listing@trientes.org");
    expect(mail.subject).toBe("New Trientes listing request req_1");
    expect(mail.text).toBe(
      [
        "New listing request",
        "",
        "Request ID: req_1",
        "Created: 2026-11-09T08:00:00.000Z",
        "User ID: user_1",
        "Username: owner",
        "Email: owner@example.com",
        "Coin: Taler (TLR)",
        "CoinGecko ID: taler",
        "",
        "Reason:",
        "Native coin of the Taler network",
        "",
        "Moderate: https://trientes.org/en/admin/requests",
      ].join("\n"),
    );
  });

  it("does not create or mail once the pending limit is reached", async () => {
    m.count.mockResolvedValue(10);

    await expect(submitCoinRequest(INPUT)).resolves.toEqual({ ok: false, reason: "too_many_pending" });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("keeps the request when the mail is not delivered", async () => {
    m.sendEmail.mockResolvedValue({ ok: false, reason: "smtp_send_failed" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(submitCoinRequest(INPUT)).resolves.toEqual({ ok: true });

    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith("[coin-request] listing notification failed", {
        requestId: "req_1",
        reason: "smtp_send_failed",
      }),
    );
  });

  it("survives a throwing email helper", async () => {
    m.sendEmail.mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(submitCoinRequest(INPUT)).resolves.toEqual({ ok: true });

    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith("[coin-request] listing notification failed", {
        requestId: "req_1",
        reason: "email_helper_exception",
      }),
    );
  });

  it("fills missing user fields and CoinGecko ID with a dash", async () => {
    m.create.mockResolvedValue({ ...CREATED, coingeckoId: null, user: { email: null, username: null } });

    await submitCoinRequest({ ...INPUT, coingeckoId: "" });

    await vi.waitFor(() => expect(m.sendEmail).toHaveBeenCalledTimes(1));
    const text: string = m.sendEmail.mock.calls[0]![0].text;
    expect(text).toContain("Username: —\nEmail: —\n");
    expect(text).toContain("CoinGecko ID: —\n");
  });
});
