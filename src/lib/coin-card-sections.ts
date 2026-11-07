// One normalizer for a section payload, used twice: by the direct write path
// (card still PENDING, slice A1) and by the revision pipeline (card published,
// slice A2). Pure — no Prisma — so a revision can compute "after" long before
// anyone decides to apply it.

import type { CardSection } from "@/lib/coin-card-risk";
import { normalizeSourceLocale } from "@/lib/prose-fields";
import { validatePayments } from "@/lib/coin-card-payments";
import { validateLegal } from "@/lib/coin-card-legal";
import {
  normalizeHttpUrl,
  validateCardBasics,
  validateContract,
  validateTokenomics,
} from "@/lib/coin-card-validate";
import { isEvmAddress, normalizeAddress } from "@/lib/evm-abi";
import { MAX_EXCLUDED } from "@/lib/coin-card-supply";
import { resolveSubstrateChain } from "@/lib/substrate-chains";
import {
  validateAllocation,
  validateUnlocks,
  type AllocationInput,
  type UnlockInput,
} from "@/lib/coin-card-tokenomics";

export const MAX_CONTRACTS = 20;
export const MAX_MARKETS = 200;
export const MAX_TAGS = 10;

export type ContractRow = {
  chain: string;
  address: string;
  decimals: number | null;
  standard: string | null;
  explorerUrl: string | null;
  isCanonical: boolean;
};

export type MarketRow = {
  kind: "CEX" | "DEX";
  exchangeName: string;
  pair: string;
  tradeUrl: string | null;
  chain: string | null;
  poolAddress: string | null;
};

export type CardStateLike = {
  name: string;
  symbol: string;
  tagline: string | null;
  description: string | null;
  logoUrl: string | null;
  launchDate: Date | string | null;
  sourceLocale?: string | null;
  tags: string[];
  links: unknown;
  tokenomics: unknown;
  security: unknown;
  payments?: unknown;
  legal?: unknown;
  teamInfo: unknown;
  marketing: unknown;
  contracts?: ContractRow[];
  markets?: MarketRow[];
};

export type SectionPatch = {
  /** Scalar / JSON columns of CoinCard to set. */
  card: Record<string, unknown>;
  /** Whole-array replacement for the child table, only for its own section. */
  contracts?: ContractRow[];
  markets?: MarketRow[];
  /** Dotted paths touched — feeds provenance and risk classification. */
  touched: string[];
};

export type NormalizeResult =
  | { ok: true; patch: SectionPatch }
  | { ok: false; reason: string };

/** Which card paths a section owns. Used for diffing and for `sectionValues`. */
export const SECTION_PATHS: Record<CardSection, readonly string[]> = {
  IDENTITY: ["name", "symbol", "tagline", "description", "logoUrl", "tags", "launchDate", "sourceLocale"],
  // Слайс S: nativeChain — свойство самой карточки, но принадлежит разделу
  // контрактов: это ответ на тот же вопрос «где живёт монета».
  CONTRACTS: ["contracts", "nativeChain"],
  TOKENOMICS: ["tokenomics"],
  MARKETS: ["markets"],
  SECURITY: ["security"],
  TEAM: ["teamInfo"],
  LINKS: ["links"],
  MARKETING: ["marketing"],
  ACCEPTANCE: [],
  PAYMENTS: ["payments"],
  LEGAL: ["legal"],
};

/**
 * Адреса исключений: дубликаты и мусор не сохраняем — на этих адресах
 * считается выпуск, и «почти адрес» там означает молча потерянный баланс.
 */
function normalizeExcludedRows(
  raw: unknown,
): Array<{ address: string; label: string | null }> | "invalid" {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ address: string; label: string | null }> = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const rawAddress = typeof r.address === "string" ? r.address.trim() : "";
    const label = typeof r.label === "string" && r.label.trim() ? r.label.trim() : null;
    if (!rawAddress) {
      if (label) return "invalid"; // подпись без адреса считать нечем
      continue;
    }
    if (!isEvmAddress(rawAddress)) return "invalid";
    const address = normalizeAddress(rawAddress);
    if (seen.has(address)) continue;
    seen.add(address);
    out.push({ address, label });
  }
  if (out.length > MAX_EXCLUDED) return "invalid";
  return out;
}

function asObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

/** Current values of everything the section owns, keyed by path. */
export function sectionValues(
  section: CardSection,
  card: CardStateLike,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of SECTION_PATHS[section]) {
    if (path === "contracts") out.contracts = card.contracts ?? [];
    else if (path === "markets") out.markets = card.markets ?? [];
    else out[path] = (card as unknown as Record<string, unknown>)[path] ?? null;
  }
  return out;
}

export function normalizeSectionPayload(
  section: CardSection,
  payload: Record<string, unknown>,
  current: CardStateLike,
): NormalizeResult {
  if (section === "CONTRACTS") {
    // Нативная сеть: пустая строка значит «монета живёт токеном в чужой сети».
    // Значение вне реестра не принимаем — иначе карточка сослалась бы на цепь,
    // которую мы не читаем, и выглядела бы проверяемой.
    const rawNative = typeof payload.nativeChain === "string" ? payload.nativeChain.trim() : "";
    if (rawNative && !resolveSubstrateChain(rawNative)) {
      return { ok: false, reason: "chain_unknown" };
    }
    const nativeChain = rawNative ? resolveSubstrateChain(rawNative)!.key : null;

    const raw = Array.isArray(payload.contracts) ? payload.contracts : [];
    if (raw.length > MAX_CONTRACTS) return { ok: false, reason: "too_many_contracts" };
    const rows: ContractRow[] = [];
    for (const c of raw) {
      const v = validateContract(c as Record<string, string>);
      if (!v.ok) return { ok: false, reason: v.reason };
      rows.push({
        ...v.data,
        isCanonical: Boolean((c as { isCanonical?: boolean }).isCanonical),
      });
    }
    return {
      ok: true,
      patch: { card: { nativeChain }, contracts: rows, touched: ["contracts", "nativeChain"] },
    };
  }

  if (section === "MARKETS") {
    const raw = Array.isArray(payload.markets) ? payload.markets : [];
    if (raw.length > MAX_MARKETS) return { ok: false, reason: "too_many_markets" };
    const rows: MarketRow[] = [];
    for (const m of raw as Array<Record<string, string>>) {
      const kind = m.kind === "DEX" ? "DEX" : "CEX";
      const exchangeName = (m.exchangeName ?? "").trim();
      const pair = (m.pair ?? "").trim().toUpperCase();
      if (!exchangeName || !pair) return { ok: false, reason: "market_incomplete" };
      const tradeUrl = normalizeHttpUrl(m.tradeUrl);
      if (tradeUrl === "invalid") return { ok: false, reason: "url_invalid" };
      rows.push({
        kind,
        exchangeName,
        pair,
        tradeUrl,
        chain: (m.chain ?? "").trim() || null,
        poolAddress: (m.poolAddress ?? "").trim() || null,
      });
    }
    return { ok: true, patch: { card: {}, markets: rows, touched: ["markets"] } };
  }

  if (section === "TOKENOMICS") {
    const t = asObject(payload.tokenomics);
    const v = validateTokenomics(t as Record<string, number | null>);
    if (!v.ok) return { ok: false, reason: v.reason };

    // Слайс E: три структурных блока внутри той же секции. Адреса исключений
    // нормализуются до адресов — по ним потом ходит `readSupplyFacts`.
    const excluded = normalizeExcludedRows(t.excluded);
    if (excluded === "invalid") return { ok: false, reason: "address_invalid" };

    const allocation = validateAllocation(t.allocation as AllocationInput[] | null);
    if (!allocation.ok) return { ok: false, reason: allocation.reason };

    const unlocks = validateUnlocks(t.unlocks as UnlockInput[] | null);
    if (!unlocks.ok) return { ok: false, reason: unlocks.reason };

    const next = {
      ...t,
      excluded,
      allocation: allocation.data,
      unlocks: unlocks.data,
    };
    return { ok: true, patch: { card: { tokenomics: next }, touched: ["tokenomics"] } };
  }

  if (section === "LINKS") {
    const incoming = asObject(payload.links);
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(incoming)) {
      const u = normalizeHttpUrl(val as string);
      if (u === "invalid") return { ok: false, reason: "url_invalid" };
      if (u) out[k] = u;
    }
    if (!out.website) return { ok: false, reason: "website_required" };
    return { ok: true, patch: { card: { links: out }, touched: ["links"] } };
  }

  if (section === "PAYMENTS") {
    const v = validatePayments(payload.payments);
    if (!v.ok) return { ok: false, reason: v.reason };
    return { ok: true, patch: { card: { payments: v.data }, touched: ["payments"] } };
  }

  if (section === "LEGAL") {
    const v = validateLegal(payload.legal);
    if (!v.ok) return { ok: false, reason: v.reason };
    return { ok: true, patch: { card: { legal: v.data }, touched: ["legal"] } };
  }

  if (section === "SECURITY") {
    return {
      ok: true,
      patch: { card: { security: asObject(payload.security) }, touched: ["security"] },
    };
  }

  if (section === "TEAM") {
    return {
      ok: true,
      patch: { card: { teamInfo: asObject(payload.teamInfo) }, touched: ["teamInfo"] },
    };
  }

  if (section === "MARKETING") {
    return {
      ok: true,
      patch: { card: { marketing: asObject(payload.marketing) }, touched: ["marketing"] },
    };
  }

  if (section === "IDENTITY") {
    const website = asObject(current.links).website;
    const v = validateCardBasics({
      name: (payload.name as string) ?? current.name,
      symbol: (payload.symbol as string) ?? current.symbol,
      tagline: (payload.tagline as string) ?? current.tagline,
      description: (payload.description as string) ?? current.description,
      website: typeof website === "string" ? website : "https://placeholder.invalid",
    });
    if (!v.ok) return { ok: false, reason: v.reason };

    const card: Record<string, unknown> = {
      name: v.data.name,
      symbol: v.data.symbol,
      tagline: v.data.tagline,
      description: v.data.description,
    };
    const touched = ["name", "symbol", "tagline", "description"];

    if (typeof payload.logoUrl === "string") {
      card.logoUrl = payload.logoUrl;
      touched.push("logoUrl");
    }
    if (Array.isArray(payload.tags)) {
      card.tags = (payload.tags as string[])
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, MAX_TAGS);
      touched.push("tags");
    }
    if ("sourceLocale" in payload) {
      // Пустое значение допустимо: тогда язык определится автоматически.
      const raw = typeof payload.sourceLocale === "string" ? payload.sourceLocale.trim() : "";
      if (raw && !normalizeSourceLocale(raw)) return { ok: false, reason: "source_locale_invalid" };
      card.sourceLocale = raw ? normalizeSourceLocale(raw) : null;
      touched.push("sourceLocale");
    }
    if ("launchDate" in payload) {
      if (typeof payload.launchDate === "string" && payload.launchDate) {
        const d = new Date(payload.launchDate);
        if (Number.isNaN(d.getTime())) return { ok: false, reason: "date_invalid" };
        card.launchDate = d;
      } else {
        card.launchDate = null;
      }
      touched.push("launchDate");
    }
    return { ok: true, patch: { card, touched } };
  }

  // ACCEPTANCE is aggregated from CompanyPoint, not typed in by the team — it
  // has no payload at all.
  return { ok: false, reason: "section_unsupported" };
}

/** Flat path → value map of what the patch sets. Feeds buildDiff(). */
export function patchValues(patch: SectionPatch): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch.card };
  if (patch.contracts) out.contracts = patch.contracts;
  if (patch.markets) out.markets = patch.markets;
  return out;
}
