import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

async function viewerId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function listViewerExchanges() {
  const userId = await viewerId();
  if (!userId) return { userId: null as string | null, exchanges: [] };
  const exchanges = await prisma.registeredExchange.findMany({
    where: { ownerUserId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, displayName: true, legalName: true, status: true },
  });
  return { userId, exchanges };
}

export async function getViewerExchangeById(exchangeId: string) {
  const userId = await viewerId();
  if (!userId) return { userId: null as string | null, exchange: null };
  const exchange = await prisma.registeredExchange.findUnique({ where: { id: exchangeId } });
  if (!exchange || exchange.ownerUserId !== userId) return { userId, exchange: null };
  return { userId, exchange };
}

// Pure validation for exchange profiles. No I/O.

function httpOrNull(raw: string | null | undefined): string | null | "invalid" {
  const s = (raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : "invalid";
  } catch {
    return "invalid";
  }
}

export type ExchangeProfileInput = {
  legalName?: string | null;
  displayName?: string | null;
  description?: string | null;
  website?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  logoUrl?: string | null;
  socials?: { network: string; url: string }[] | null;
};

export type ValidatedExchangeProfile = {
  legalName: string;
  displayName: string;
  description: string | null;
  website: string;
  country: string;
  email: string;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
};

export type ExchangeProfileResult =
  | { ok: true; data: ValidatedExchangeProfile }
  | {
      ok: false;
      reason:
        | "legal_name_required"
        | "display_name_required"
        | "website_required"
        | "website_invalid"
        | "country_required"
        | "email_required"
        | "logo_invalid";
    };

export function validateExchangeProfile(input: ExchangeProfileInput): ExchangeProfileResult {
  const legalName = (input.legalName ?? "").trim();
  if (!legalName) return { ok: false, reason: "legal_name_required" };
  const displayName = (input.displayName ?? "").trim();
  if (!displayName) return { ok: false, reason: "display_name_required" };
  const country = (input.country ?? "").trim();
  if (!country) return { ok: false, reason: "country_required" };
  const email = (input.email ?? "").trim();
  if (!email) return { ok: false, reason: "email_required" };
  const websiteRaw = (input.website ?? "").trim();
  if (!websiteRaw) return { ok: false, reason: "website_required" };
  // websiteRaw is non-empty here, so httpOrNull cannot return null.
  const website = httpOrNull(websiteRaw) as string | "invalid";
  if (website === "invalid") return { ok: false, reason: "website_invalid" };
  const logoUrl = httpOrNull(input.logoUrl);
  if (logoUrl === "invalid") return { ok: false, reason: "logo_invalid" };
  const t = (v: string | null | undefined) => {
    const s = (v ?? "").trim();
    return s ? s : null;
  };
  // `socials` is intentionally excluded from ValidatedExchangeProfile — it is passed
  // through at the call site and validated at the mapper layer (same pattern as company.ts).
  return {
    ok: true,
    data: {
      legalName,
      displayName,
      description: t(input.description),
      website,
      country,
      email,
      phone: t(input.phone),
      address: t(input.address),
      logoUrl,
    },
  };
}
