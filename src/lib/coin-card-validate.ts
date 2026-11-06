export type Fail<R extends string> = { ok: false; reason: R };
export type Ok<T> = { ok: true; data: T };

export const SUPPORTED_CHAINS = [
  "ethereum", "bsc", "polygon", "arbitrum", "optimism", "base", "avalanche",
  "solana", "tron", "ton", "bitcoin", "cardano", "cosmos", "near", "sui", "aptos",
] as const;
export type Chain = (typeof SUPPORTED_CHAINS)[number];

const EVM_CHAINS = new Set<string>([
  "ethereum", "bsc", "polygon", "arbitrum", "optimism", "base", "avalanche",
]);
const BASE58_CHAINS = new Set<string>(["solana", "tron"]);

/**
 * Accepts bare hosts ("example.com") and http(s) URLs; rejects every other
 * scheme. Returns null for blank input, "invalid" for unusable input.
 * Defence in depth against `javascript:` ending up in an href.
 */
export function normalizeHttpUrl(raw: string | null | undefined): string | null | "invalid" {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return "invalid";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "invalid";
  if (!u.hostname.includes(".")) return "invalid";
  return u.toString().replace(/\/$/, "");
}

export type BasicsInput = {
  name?: string | null;
  symbol?: string | null;
  tagline?: string | null;
  description?: string | null;
  website?: string | null;
};
export type BasicsData = {
  name: string;
  symbol: string;
  tagline: string | null;
  description: string | null;
  website: string;
};
export type BasicsReason =
  | "name_required" | "name_too_long"
  | "symbol_required" | "symbol_too_long" | "symbol_invalid"
  | "tagline_too_long" | "description_too_long"
  | "website_required" | "url_invalid";

export function validateCardBasics(
  input: BasicsInput,
): Ok<BasicsData> | Fail<BasicsReason> {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, reason: "name_required" };
  if (name.length > 100) return { ok: false, reason: "name_too_long" };

  const symbolRaw = (input.symbol ?? "").trim();
  if (!symbolRaw) return { ok: false, reason: "symbol_required" };
  const symbol = symbolRaw.toUpperCase();
  if (symbol.length > 12) return { ok: false, reason: "symbol_too_long" };
  if (!/^[A-Z0-9]+$/.test(symbol)) return { ok: false, reason: "symbol_invalid" };

  const tagline = (input.tagline ?? "").trim() || null;
  if (tagline && tagline.length > 120) return { ok: false, reason: "tagline_too_long" };

  const description = (input.description ?? "").trim() || null;
  if (description && description.length > 20000) {
    return { ok: false, reason: "description_too_long" };
  }

  const websiteRaw = (input.website ?? "").trim();
  if (!websiteRaw) return { ok: false, reason: "website_required" };
  const website = normalizeHttpUrl(websiteRaw);
  if (website === "invalid" || website === null) {
    return { ok: false, reason: "url_invalid" };
  }

  return { ok: true, data: { name, symbol, tagline, description, website } };
}

export type ContractInput = {
  chain?: string | null;
  address?: string | null;
  decimals?: number | null;
  standard?: string | null;
  explorerUrl?: string | null;
};
export type ContractData = {
  chain: Chain;
  address: string;
  decimals: number | null;
  standard: string | null;
  explorerUrl: string | null;
};
export type ContractReason =
  | "chain_unknown" | "contract_required" | "contract_invalid"
  | "decimals_invalid" | "url_invalid";

export function validateContract(
  input: ContractInput,
): Ok<ContractData> | Fail<ContractReason> {
  const chain = (input.chain ?? "").trim().toLowerCase();
  if (!(SUPPORTED_CHAINS as readonly string[]).includes(chain)) {
    return { ok: false, reason: "chain_unknown" };
  }

  const raw = (input.address ?? "").trim();
  if (!raw) return { ok: false, reason: "contract_required" };

  let address = raw;
  if (EVM_CHAINS.has(chain)) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return { ok: false, reason: "contract_invalid" };
    address = raw.toLowerCase();
  } else if (BASE58_CHAINS.has(chain)) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw)) {
      return { ok: false, reason: "contract_invalid" };
    }
  } else if (raw.length < 4 || raw.length > 128) {
    return { ok: false, reason: "contract_invalid" };
  }

  const decimals = input.decimals ?? null;
  if (decimals !== null) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      return { ok: false, reason: "decimals_invalid" };
    }
  }

  const explorerUrl = normalizeHttpUrl(input.explorerUrl);
  if (explorerUrl === "invalid") return { ok: false, reason: "url_invalid" };

  return {
    ok: true,
    data: {
      chain: chain as Chain,
      address,
      decimals,
      standard: (input.standard ?? "").trim() || null,
      explorerUrl,
    },
  };
}

export type TokenomicsInput = {
  circulating?: number | null;
  total?: number | null;
  max?: number | null;
};
export type TokenomicsReason = "supply_negative" | "supply_inconsistent";

export function validateTokenomics(
  input: TokenomicsInput,
): Ok<TokenomicsInput> | Fail<TokenomicsReason> {
  const vals = [input.circulating, input.total, input.max];
  if (vals.some((v) => v != null && (!Number.isFinite(v) || v < 0))) {
    return { ok: false, reason: "supply_negative" };
  }
  const { circulating: c, total: t, max: m } = input;
  if (c != null && t != null && c > t) return { ok: false, reason: "supply_inconsistent" };
  if (t != null && m != null && t > m) return { ok: false, reason: "supply_inconsistent" };
  if (c != null && m != null && c > m) return { ok: false, reason: "supply_inconsistent" };
  return { ok: true, data: input };
}
