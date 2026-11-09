"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { mailListingDesk, listingDeskAdminUrl } from "@/lib/listing-desk";
import { validateCardBasics, type BasicsData } from "@/lib/coin-card-validate";
import { buildSlugCandidates } from "@/lib/coin-card-slug";
import { computeCompleteness, missingFields } from "@/lib/coin-card-completeness";
import { markSelfReported } from "@/lib/coin-card-provenance";
import { canEditCardDirectly } from "@/lib/coin-card-access";
import { normalizeSectionPayload } from "@/lib/coin-card-sections";
import type { CardSection } from "@/lib/coin-card-risk";

const MAX_PENDING_PER_USER = 3;

export type CreateResult =
  | { ok: true; cardId: string; slug: string }
  | { ok: false; reason: string };

type CreatedCard = {
  id: string;
  slug: string;
  createdAt: Date;
  steward: { email: string | null; username: string | null } | null;
};

// Best-effort heads-up to the listing desk mailbox; the card is already in
// the /admin/coin-cards queue, so a lost email never fails the submission.
async function notifyListingDesk(card: CreatedCard, userId: string, data: BasicsData) {
  const text = [
    "New listing request (coin card)",
    "",
    `Card ID: ${card.id}`,
    `Slug: ${card.slug}`,
    `Created: ${card.createdAt.toISOString()}`,
    `User ID: ${userId}`,
    `Username: ${card.steward?.username ?? "—"}`,
    `Email: ${card.steward?.email ?? "—"}`,
    `Coin: ${data.name} (${data.symbol})`,
    `Website: ${data.website}`,
    `Tagline: ${data.tagline ?? "—"}`,
    "",
    "Description:",
    data.description ?? "—",
    "",
    "The card is PENDING. The applicant may still be adding contracts, tokenomics and trust details.",
    `Moderate: ${listingDeskAdminUrl("coin-cards")}`,
  ].join("\n");
  const r = await mailListingDesk(`New Trientes listing request: ${card.slug}`, text);
  if (!r.ok) {
    console.error("[coin-card] listing notification failed", { cardId: card.id, reason: r.reason });
  }
}

/**
 * Step 1 of the wizard: creates the card in PENDING with the minimum viable
 * field set. Steps 2-4 call saveCoinCardSection(). The creator becomes the
 * card's steward and OWNER member — not a verified project owner, which only
 * a claim (slice D) can confer.
 */
export async function createCoinCard(input: {
  name: string;
  symbol: string;
  tagline?: string;
  description?: string;
  website: string;
}): Promise<CreateResult> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  const v = validateCardBasics(input);
  if (!v.ok) return { ok: false, reason: v.reason };

  const pending = await prisma.coinCard.count({
    where: { stewardUserId: userId, status: "PENDING" },
  });
  if (pending >= MAX_PENDING_PER_USER) return { ok: false, reason: "too_many_pending" };

  const now = new Date();
  const links = { website: v.data.website };
  const completeness = computeCompleteness({ ...v.data, links });
  const provenance = markSelfReported(
    {},
    ["name", "symbol", "tagline", "description", "links.website"],
    now,
  );

  // Try slug candidates in order; P2002 on `slug` means someone took it first.
  for (const slug of buildSlugCandidates(v.data.name, v.data.symbol)) {
    try {
      const card = await prisma.coinCard.create({
        data: {
          slug,
          stewardUserId: userId,
          name: v.data.name,
          symbol: v.data.symbol,
          tagline: v.data.tagline,
          description: v.data.description,
          links,
          provenance,
          completeness,
          members: { create: { userId, role: "OWNER", isSigner: true } },
          policy: { create: {} },
        },
        select: {
          id: true,
          slug: true,
          createdAt: true,
          steward: { select: { email: true, username: true } },
        },
      });
      void notifyListingDesk(card, userId, v.data);
      revalidatePath("/", "layout");
      return { ok: true, cardId: card.id, slug: card.slug };
    } catch (e) {
      const taken =
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        String(e.meta?.target ?? "").includes("slug");
      if (!taken) throw e;
    }
  }
  return { ok: false, reason: "slug_taken" };
}

export type SaveResult =
  | { ok: true; completeness: number; missing: string[] }
  | { ok: false; reason: string };

/**
 * Wizard steps 2-4. Writes straight to the card, which canEditCardNow() only
 * allows while it is PENDING/REJECTED. Post-approval edits land in slice A2
 * as reviewable revisions.
 */
export async function saveCoinCardSection(input: {
  cardId: string;
  section: CardSection;
  payload: Record<string, unknown>;
}): Promise<SaveResult> {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  const userId = user?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  const card = await prisma.coinCard.findUnique({
    where: { id: input.cardId },
    select: {
      id: true, status: true, stewardUserId: true, name: true, symbol: true,
      tagline: true, description: true, logoUrl: true, launchDate: true, tags: true,
      links: true, tokenomics: true, security: true, teamInfo: true, marketing: true,
      provenance: true,
      members: { select: { userId: true, role: true, sections: true } },
    },
  });
  if (!card) return { ok: false, reason: "not_found" };

  const member = card.members.find((m) => m.userId === userId) ?? null;
  if (!canEditCardDirectly(card, member, input.section, user?.role === "ADMIN")) {
    return { ok: false, reason: "forbidden" };
  }

  const norm = normalizeSectionPayload(input.section, input.payload, card);
  if (!norm.ok) return { ok: false, reason: norm.reason };
  const { patch } = norm;

  if (patch.contracts) {
    await prisma.$transaction([
      prisma.coinCardContract.deleteMany({ where: { cardId: card.id } }),
      prisma.coinCardContract.createMany({
        data: patch.contracts.map((r) => ({ ...r, cardId: card.id })),
        skipDuplicates: true,
      }),
    ]);
  }
  if (patch.markets) {
    await prisma.$transaction([
      prisma.coinCardMarket.deleteMany({ where: { cardId: card.id } }),
      prisma.coinCardMarket.createMany({
        data: patch.markets.map((r) => ({ ...r, cardId: card.id })),
        skipDuplicates: true,
      }),
    ]);
  }

  // Child rows live in their own tables, so count them for the score rather
  // than trusting the in-memory payload.
  const [contracts, markets] = await Promise.all([
    prisma.coinCardContract.count({ where: { cardId: card.id } }),
    prisma.coinCardMarket.count({ where: { cardId: card.id } }),
  ]);
  const forScore = {
    ...(card as Record<string, unknown>),
    ...patch.card,
    contracts: new Array(contracts).fill(null),
    markets: new Array(markets).fill(null),
  };
  const completeness = computeCompleteness(forScore);
  const missing = missingFields(forScore);

  await prisma.coinCard.update({
    where: { id: card.id },
    data: {
      ...patch.card,
      completeness,
      provenance: markSelfReported(card.provenance, patch.touched, new Date()),
    },
  });

  revalidatePath("/", "layout");
  return { ok: true, completeness, missing };
}
