export type CoinRequestInput = {
  name?: string | null;
  symbol?: string | null;
  coingeckoId?: string | null;
  reason?: string | null;
};

export type ValidatedCoinRequest = {
  name: string;
  symbol: string;
  coingeckoId: string | null;
  reason: string;
};

export type CoinRequestReason =
  | "name_required"
  | "symbol_required"
  | "symbol_too_long"
  | "reason_too_short"
  | "reason_too_long"
  | "coingecko_id_invalid";

export type ValidationResult =
  | { ok: true; data: ValidatedCoinRequest }
  | { ok: false; reason: CoinRequestReason };

export function validateCoinRequest(input: CoinRequestInput): ValidationResult {
  const name = (input.name ?? "").trim();
  const symbolRaw = (input.symbol ?? "").trim();
  const reason = (input.reason ?? "").trim();
  const cgRaw = (input.coingeckoId ?? "").trim();

  if (!name) return { ok: false, reason: "name_required" };
  if (!symbolRaw) return { ok: false, reason: "symbol_required" };
  const symbol = symbolRaw.toUpperCase();
  if (symbol.length > 12) return { ok: false, reason: "symbol_too_long" };
  if (reason.length < 5) return { ok: false, reason: "reason_too_short" };
  if (reason.length > 2000) return { ok: false, reason: "reason_too_long" };

  let coingeckoId: string | null = null;
  if (cgRaw) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(cgRaw)) {
      return { ok: false, reason: "coingecko_id_invalid" };
    }
    coingeckoId = cgRaw.toLowerCase();
  }

  return { ok: true, data: { name, symbol, coingeckoId, reason } };
}
