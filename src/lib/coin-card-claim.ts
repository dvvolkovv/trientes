/**
 * Ядро слайса D: правила заявки на владение карточкой и проверка доказательств.
 *
 * Админский перенос карточки (`transferCoinCard`) остаётся как ручная отмычка,
 * но обычный путь теперь такой: проект предъявляет то, что может предъявить
 * только владелец, мы это проверяем сами, и `trust` поднимается без человека в
 * середине.
 */

import { randomBytes } from "node:crypto";
import { ethCall } from "@/lib/evm-rpc";
import type { FetchLike } from "@/lib/evm-rpc";
import { SELECTORS, normalizeAddress } from "@/lib/evm-abi";
import { resolveEvmChain, rpcUrlFor } from "@/lib/evm-chains";
import { recoverSigner, sameAddress } from "@/lib/evm-signature";
import {
  containsToken,
  fetchTxtRecords,
  fetchWellKnown,
  type DomainFetch,
} from "@/lib/claim-domain";

export type ClaimMethod = "OWNER_SIGNATURE" | "DNS_TXT" | "WELL_KNOWN";
export type ClaimStatus = "PENDING" | "VERIFIED" | "FAILED" | "EXPIRED" | "CANCELLED";
export type Trust = "UNVERIFIED" | "CONTRACT_VERIFIED" | "PROJECT_CLAIMED" | "FULLY_VERIFIED";

export type ClaimError =
  | "signature_invalid"
  | "signature_wrong_address"
  | "no_owner"
  | "owner_unreadable"
  | "chain_unsupported"
  | "dns_no_record"
  | "dns_unreachable"
  | "well_known_missing"
  | "well_known_unreachable"
  | "token_not_found"
  | "signature_required";

/** Срок жизни вызова. Дольше — и токен начинает жить своей жизнью. */
export const CLAIM_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Проверка не чаще раза в минуту: DNS и чужой сайт не для обстрела кнопкой. */
export const CHECK_WINDOW_MS = 60 * 1000;
export const MAX_ATTEMPTS = 10;
export const MAX_OPEN_CLAIMS_PER_USER = 3;
export const MAX_OPEN_CLAIMS_PER_CARD = 3;

/** Токен вызова: угадать нельзя, искать в тексте удобно. */
export function claimToken(): string {
  return `trientes-${randomBytes(20).toString("hex")}`;
}

/**
 * Текст, который подписывает кошелёк. Токен внутри — поэтому подпись нельзя
 * переставить на другую карточку или предъявить от чужого имени.
 */
export function claimMessage(args: { slug: string; claimant: string; token: string }): string {
  return [
    "Trientes card ownership claim",
    `card: ${args.slug}`,
    `claimant: ${args.claimant}`,
    `token: ${args.token}`,
  ].join("\n");
}

/**
 * Уровень доверия после успешного claim. Сверенный контракт плюс
 * подтверждённый проект — это уже всё, что мы умеем проверить.
 */
export function nextTrust(contractVerified: boolean): Trust {
  return contractVerified ? "FULLY_VERIFIED" : "PROJECT_CLAIMED";
}

/** Карточка, которую проект уже подтвердил, новых заявок не принимает. */
export const isClaimed = (trust: string): boolean =>
  trust === "PROJECT_CLAIMED" || trust === "FULLY_VERIFIED";

export type StartGuard =
  | { ok: true }
  | { ok: false; reason: "already_claimed" | "too_many_claims" | "no_website" | "no_contracts" };

export function canStartClaim(args: {
  trust: string;
  method: ClaimMethod;
  openByUser: number;
  openByCard: number;
  domain: string | null;
  canonicalContract: boolean;
}): StartGuard {
  if (isClaimed(args.trust)) return { ok: false, reason: "already_claimed" };
  if (args.openByUser >= MAX_OPEN_CLAIMS_PER_USER) return { ok: false, reason: "too_many_claims" };
  if (args.openByCard >= MAX_OPEN_CLAIMS_PER_CARD) return { ok: false, reason: "too_many_claims" };
  if (args.method === "OWNER_SIGNATURE" && !args.canonicalContract) {
    return { ok: false, reason: "no_contracts" };
  }
  if (args.method !== "OWNER_SIGNATURE" && !args.domain) return { ok: false, reason: "no_website" };
  return { ok: true };
}

export type CheckGuard =
  | { ok: true }
  | { ok: false; reason: "claim_closed" | "too_soon" | "attempts_exhausted" | "expired" };

export function canCheckClaim(
  claim: { status: string; attempts: number; lastTriedAt: Date | null; expiresAt: Date },
  now: Date,
): CheckGuard {
  if (claim.status !== "PENDING") return { ok: false, reason: "claim_closed" };
  if (claim.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (claim.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "attempts_exhausted" };
  if (claim.lastTriedAt && now.getTime() - claim.lastTriedAt.getTime() < CHECK_WINDOW_MS) {
    return { ok: false, reason: "too_soon" };
  }
  return { ok: true };
}

/* ─── проверка доказательств ─────────────────────────────────────────────── */

export type ProofInput = {
  method: ClaimMethod;
  token: string;
  /** Текст вызова для подписи. */
  message: string;
  /** Домен сайта карточки (DNS и файл). */
  domain: string | null;
  /** Канонический контракт карточки (подпись). */
  contract: { chain: string; address: string } | null;
  /** Подпись, введённая проектом. */
  signature?: string | null;
};

export type ProofResult =
  | { ok: true; target: string }
  | { ok: false; error: ClaimError };

/** Адрес владельца токена: `owner()` канонического контракта. */
export async function readContractOwner(
  contract: { chain: string; address: string },
  opts: { fetchImpl?: FetchLike } = {},
): Promise<{ owner: string; error: null } | { owner: null; error: ClaimError }> {
  const chain = resolveEvmChain(contract.chain);
  if (!chain) return { owner: null, error: "chain_unsupported" };
  const url = rpcUrlFor(chain);
  let raw: string;
  try {
    raw = await ethCall(url, contract.address, SELECTORS.owner, { fetchImpl: opts.fetchImpl });
  } catch {
    return { owner: null, error: "owner_unreadable" };
  }
  const hex = (raw ?? "").replace(/^0x/, "");
  // Контракт без `owner()` отвечает пустотой — это «способ недоступен», а не сбой.
  if (hex.length < 40) return { owner: null, error: "no_owner" };
  const owner = `0x${hex.slice(-40)}`;
  if (!/[1-9a-f]/.test(owner.slice(2))) return { owner: null, error: "no_owner" };
  return { owner: normalizeAddress(owner), error: null };
}

export async function verifyProof(
  input: ProofInput,
  deps: { fetchImpl?: FetchLike; domainFetch?: DomainFetch } = {},
): Promise<ProofResult> {
  if (input.method === "OWNER_SIGNATURE") {
    if (!input.contract) return { ok: false, error: "no_owner" };
    if (!input.signature || input.signature.trim() === "") {
      return { ok: false, error: "signature_required" };
    }
    const owner = await readContractOwner(input.contract, { fetchImpl: deps.fetchImpl });
    if (owner.error) return { ok: false, error: owner.error };

    const recovered = recoverSigner(input.message, input.signature);
    if (recovered.error) return { ok: false, error: recovered.error };
    if (!sameAddress(recovered.address, owner.owner)) {
      return { ok: false, error: "signature_wrong_address" };
    }
    return { ok: true, target: owner.owner };
  }

  if (!input.domain) return { ok: false, error: "token_not_found" };

  if (input.method === "DNS_TXT") {
    const txt = await fetchTxtRecords(input.domain, { fetchImpl: deps.domainFetch });
    if (txt.error) return { ok: false, error: txt.error };
    const hit = txt.records.some((r) => containsToken(r, input.token));
    return hit ? { ok: true, target: input.domain } : { ok: false, error: "token_not_found" };
  }

  const file = await fetchWellKnown(input.domain, { fetchImpl: deps.domainFetch });
  if (file.error) return { ok: false, error: file.error };
  return containsToken(file.body, input.token)
    ? { ok: true, target: input.domain }
    : { ok: false, error: "token_not_found" };
}

/* ─── прогон по базе ─────────────────────────────────────────────────────── */

export type PrismaLike = {
  coinCardClaim: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

/** Просроченные вызовы гасит воркер: автопроверки нет, их предъявляет человек. */
export async function expireStaleClaims(args: {
  prisma: PrismaLike;
  now?: Date;
}): Promise<number> {
  const now = args.now ?? new Date();
  const { count } = await args.prisma.coinCardClaim.updateMany({
    where: { status: "PENDING", expiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  });
  return count;
}
