"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  validateCardBasics,
  validateContract,
  validateTokenomics,
  normalizeHttpUrl,
} from "@/lib/coin-card-validate";
import { buildSlugCandidates } from "@/lib/coin-card-slug";
import { computeCompleteness, missingFields } from "@/lib/coin-card-completeness";
import { markSelfReported } from "@/lib/coin-card-provenance";
import { canEditCardNow } from "@/lib/coin-card-access";
import type { CardSection } from "@/lib/coin-card-risk";

const MAX_PENDING_PER_USER = 3;
const MAX_CONTRACTS = 20;
const MAX_MARKETS = 200;

export type CreateResult =
  | { ok: true; cardId: string; slug: string }
  | { ok: false; reason: string };

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
        select: { id: true, slug: true },
      });
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
    },
  });
  if (!card) return { ok: false, reason: "not_found" };
  if (!canEditCardNow(card, userId, user?.role === "ADMIN")) {
    return { ok: false, reason: "forbidden" };
  }

  const now = new Date();
  const data: Record<string, unknown> = {};
  const touched: string[] = [];

  if (input.section === "CONTRACTS") {
    const raw = Array.isArray(input.payload.contracts) ? input.payload.contracts : [];
    if (raw.length > MAX_CONTRACTS) return { ok: false, reason: "too_many_contracts" };
    const rows = [];
    for (const c of raw) {
      const v = validateContract(c as Record<string, string>);
      if (!v.ok) return { ok: false, reason: v.reason };
      rows.push({ ...v.data, isCanonical: Boolean((c as { isCanonical?: boolean }).isCanonical) });
    }
    await prisma.$transaction([
      prisma.coinCardContract.deleteMany({ where: { cardId: card.id } }),
      prisma.coinCardContract.createMany({
        data: rows.map((r) => ({ ...r, cardId: card.id })),
        skipDuplicates: true,
      }),
    ]);
    touched.push("contracts");
  } else if (input.section === "TOKENOMICS") {
    const t = (input.payload.tokenomics ?? {}) as Record<string, unknown>;
    const v = validateTokenomics(t as Record<string, number | null>);
    if (!v.ok) return { ok: false, reason: v.reason };
    data.tokenomics = t;
    touched.push("tokenomics.circulating", "tokenomics.total", "tokenomics.max");
  } else if (input.section === "MARKETS") {
    const raw = Array.isArray(input.payload.markets) ? input.payload.markets : [];
    if (raw.length > MAX_MARKETS) return { ok: false, reason: "too_many_markets" };
    const rows = [];
    for (const m of raw as Array<Record<string, string>>) {
      const kind = m.kind === "DEX" ? "DEX" : "CEX";
      const exchangeName = (m.exchangeName ?? "").trim();
      const pair = (m.pair ?? "").trim().toUpperCase();
      if (!exchangeName || !pair) return { ok: false, reason: "market_incomplete" };
      const tradeUrl = normalizeHttpUrl(m.tradeUrl);
      if (tradeUrl === "invalid") return { ok: false, reason: "url_invalid" };
      rows.push({
        cardId: card.id, kind, exchangeName, pair, tradeUrl,
        chain: (m.chain ?? "").trim() || null,
        poolAddress: (m.poolAddress ?? "").trim() || null,
      });
    }
    await prisma.$transaction([
      prisma.coinCardMarket.deleteMany({ where: { cardId: card.id } }),
      prisma.coinCardMarket.createMany({ data: rows, skipDuplicates: true }),
    ]);
    touched.push("markets");
  } else if (input.section === "LINKS") {
    const incoming = (input.payload.links ?? {}) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(incoming)) {
      const u = normalizeHttpUrl(val);
      if (u === "invalid") return { ok: false, reason: "url_invalid" };
      if (u) out[k] = u;
      touched.push(`links.${k}`);
    }
    if (!out.website) return { ok: false, reason: "website_required" };
    data.links = out;
  } else if (input.section === "SECURITY") {
    data.security = input.payload.security ?? {};
    touched.push("security");
  } else if (input.section === "TEAM") {
    data.teamInfo = input.payload.teamInfo ?? {};
    touched.push("teamInfo");
  } else if (input.section === "MARKETING") {
    data.marketing = input.payload.marketing ?? {};
    touched.push("marketing");
  } else if (input.section === "IDENTITY") {
    const v = validateCardBasics({
      name: (input.payload.name as string) ?? card.name,
      symbol: (input.payload.symbol as string) ?? card.symbol,
      tagline: (input.payload.tagline as string) ?? card.tagline,
      description: (input.payload.description as string) ?? card.description,
      website: (card.links as Record<string, string> | null)?.website ?? "",
    });
    if (!v.ok) return { ok: false, reason: v.reason };
    data.name = v.data.name;
    data.symbol = v.data.symbol;
    data.tagline = v.data.tagline;
    data.description = v.data.description;
    if (typeof input.payload.logoUrl === "string") data.logoUrl = input.payload.logoUrl;
    if (Array.isArray(input.payload.tags)) {
      data.tags = (input.payload.tags as string[])
        .map((s) => s.trim()).filter(Boolean).slice(0, 10);
    }
    if (typeof input.payload.launchDate === "string" && input.payload.launchDate) {
      const d = new Date(input.payload.launchDate);
      if (Number.isNaN(d.getTime())) return { ok: false, reason: "date_invalid" };
      data.launchDate = d;
    }
    touched.push("name", "symbol", "tagline", "description", "logoUrl", "tags", "launchDate");
  } else {
    return { ok: false, reason: "section_unsupported" };
  }

  // Child rows live in their own tables, so count them for the score rather
  // than trusting the in-memory payload.
  const [contracts, markets] = await Promise.all([
    prisma.coinCardContract.count({ where: { cardId: card.id } }),
    prisma.coinCardMarket.count({ where: { cardId: card.id } }),
  ]);
  const forScore = {
    ...(card as Record<string, unknown>),
    ...data,
    contracts: new Array(contracts).fill(null),
    markets: new Array(markets).fill(null),
  };
  const completeness = computeCompleteness(forScore);
  const missing = missingFields(forScore);

  await prisma.coinCard.update({
    where: { id: card.id },
    data: {
      ...data,
      completeness,
      provenance: markSelfReported(card.provenance, touched, now),
    },
  });

  revalidatePath("/", "layout");
  return { ok: true, completeness, missing };
}
