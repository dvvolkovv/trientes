import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  sendEmail: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { coinCard: { count: m.count, create: m.create } },
}));
vi.mock("@/lib/email", () => ({ sendEmail: m.sendEmail }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));

import { createCoinCard } from "@/app/actions/coin-card";

const INPUT = {
  name: "Foobar Chain",
  symbol: "foo",
  tagline: "Payments for farmers",
  description: "Native coin of the Foobar network",
  website: "foobar.org",
};

const CREATED = {
  id: "card_1",
  slug: "foobar-chain",
  createdAt: new Date("2026-11-09T08:00:00.000Z"),
  steward: { email: "owner@example.com", username: "owner" },
};

function slugTaken() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["slug"] },
  });
}

describe("createCoinCard listing desk mail", () => {
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

  it("mails the listing desk once the card is created", async () => {
    await expect(createCoinCard(INPUT)).resolves.toEqual({
      ok: true,
      cardId: "card_1",
      slug: "foobar-chain",
    });

    expect(m.create.mock.calls[0]![0].select).toEqual({
      id: true,
      slug: true,
      createdAt: true,
      steward: { select: { email: true, username: true } },
    });

    await vi.waitFor(() => expect(m.sendEmail).toHaveBeenCalledTimes(1));
    const mail = m.sendEmail.mock.calls[0]![0];
    expect(mail.to).toBe("listing@trientes.org");
    expect(mail.subject).toBe("New Trientes listing request: foobar-chain");
    expect(mail.text).toBe(
      [
        "New listing request (coin card)",
        "",
        "Card ID: card_1",
        "Slug: foobar-chain",
        "Created: 2026-11-09T08:00:00.000Z",
        "User ID: user_1",
        "Username: owner",
        "Email: owner@example.com",
        "Coin: Foobar Chain (FOO)",
        "Website: https://foobar.org",
        "Tagline: Payments for farmers",
        "",
        "Description:",
        "Native coin of the Foobar network",
        "",
        "The card is PENDING. The applicant may still be adding contracts, tokenomics and trust details.",
        "Moderate: https://trientes.org/en/admin/coin-cards",
      ].join("\n"),
    );
  });

  it("mails only for the slug that was actually stored", async () => {
    m.create
      .mockRejectedValueOnce(slugTaken())
      .mockResolvedValueOnce({ ...CREATED, slug: "foobar-chain-foo" });

    await expect(createCoinCard(INPUT)).resolves.toMatchObject({ ok: true, slug: "foobar-chain-foo" });

    await vi.waitFor(() => expect(m.sendEmail).toHaveBeenCalledTimes(1));
    expect(m.sendEmail.mock.calls[0]![0].subject).toBe(
      "New Trientes listing request: foobar-chain-foo",
    );
  });

  it("does not create or mail once the pending limit is reached", async () => {
    m.count.mockResolvedValue(3);

    await expect(createCoinCard(INPUT)).resolves.toEqual({ ok: false, reason: "too_many_pending" });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("does not mail for invalid input", async () => {
    await expect(createCoinCard({ ...INPUT, website: "" })).resolves.toEqual({
      ok: false,
      reason: "website_required",
    });
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("keeps the card when the mail is not delivered", async () => {
    m.sendEmail.mockResolvedValue({ ok: false, reason: "smtp_send_failed" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(createCoinCard(INPUT)).resolves.toMatchObject({ ok: true, cardId: "card_1" });

    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith("[coin-card] listing notification failed", {
        cardId: "card_1",
        reason: "smtp_send_failed",
      }),
    );
  });

  it("survives a throwing email helper", async () => {
    m.sendEmail.mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(createCoinCard(INPUT)).resolves.toMatchObject({ ok: true, cardId: "card_1" });

    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith("[coin-card] listing notification failed", {
        cardId: "card_1",
        reason: "email_helper_exception",
      }),
    );
  });

  it("fills missing optional fields with a dash", async () => {
    m.create.mockResolvedValue({ ...CREATED, steward: null });

    await createCoinCard({ ...INPUT, tagline: "", description: "" });

    await vi.waitFor(() => expect(m.sendEmail).toHaveBeenCalledTimes(1));
    const text: string = m.sendEmail.mock.calls[0]![0].text;
    expect(text).toContain("Username: —\nEmail: —\n");
    expect(text).toContain("Tagline: —\n\nDescription:\n—\n");
  });
});
