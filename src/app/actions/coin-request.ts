"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { validateCoinRequest } from "@/lib/coin-request";

const MAX_PENDING_PER_USER = 10;
const SITE_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";
const LISTING_REQUESTS_TO = process.env.LISTING_REQUESTS_TO ?? "listing@trientes.org";

type CreatedRequest = {
  id: string;
  userId: string;
  name: string;
  symbol: string;
  coingeckoId: string | null;
  reason: string;
  createdAt: Date;
  user: { email: string | null; username: string | null };
};

// Best-effort heads-up to the listing desk mailbox; the request is already stored
// and moderated in /admin/requests, so a lost email never fails the submission.
async function notifyListingDesk(request: CreatedRequest): Promise<void> {
  const text = [
    "New listing request",
    "",
    `Request ID: ${request.id}`,
    `Created: ${request.createdAt.toISOString()}`,
    `User ID: ${request.userId}`,
    `Username: ${request.user.username ?? "—"}`,
    `Email: ${request.user.email ?? "—"}`,
    `Coin: ${request.name} (${request.symbol})`,
    `CoinGecko ID: ${request.coingeckoId ?? "—"}`,
    "",
    "Reason:",
    request.reason,
    "",
    `Moderate: ${SITE_ORIGIN.replace(/\/+$/, "")}/en/admin/requests`,
  ].join("\n");
  let reason: string | undefined;
  try {
    const r = await sendEmail({
      to: LISTING_REQUESTS_TO,
      subject: `New Trientes listing request ${request.id}`,
      text,
    });
    if (r.ok) return;
    reason = r.reason ?? "unknown";
  } catch {
    reason = "email_helper_exception";
  }
  console.error("[coin-request] listing notification failed", { requestId: request.id, reason });
}

export async function submitCoinRequest(input: {
  name: string;
  symbol: string;
  coingeckoId?: string;
  reason: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  const validated = validateCoinRequest(input);
  if (!validated.ok) return { ok: false, reason: validated.reason };

  // Anti-spam: limit pending requests per user.
  const pendingCount = await prisma.coinRequest.count({
    where: { userId, status: "PENDING" },
  });
  if (pendingCount >= MAX_PENDING_PER_USER) {
    return { ok: false, reason: "too_many_pending" };
  }

  const request = await prisma.coinRequest.create({
    data: {
      userId,
      name: validated.data.name,
      symbol: validated.data.symbol,
      coingeckoId: validated.data.coingeckoId,
      reason: validated.data.reason,
    },
    include: { user: { select: { email: true, username: true } } },
  });
  void notifyListingDesk(request);
  revalidatePath("/", "layout");
  return { ok: true };
}
