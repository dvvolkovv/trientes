import { describe, it, expect } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import * as secp from "@noble/secp256k1";
import { addressFromPublicKey, personalMessageHash } from "../src/lib/evm-signature";
import type { DomainFetch } from "../src/lib/claim-domain";
import { TXT_PREFIX } from "../src/lib/claim-domain";
import type { FetchLike } from "../src/lib/evm-rpc";
import {
  canCheckClaim,
  canStartClaim,
  claimMessage,
  claimToken,
  CLAIM_TTL_MS,
  expireStaleClaims,
  isClaimed,
  MAX_ATTEMPTS,
  nextTrust,
  readContractOwner,
  verifyProof,
} from "../src/lib/coin-card-claim";

secp.hashes.sha256 = sha256;
secp.hashes.hmacSha256 = (k: Uint8Array, m: Uint8Array) => hmac(sha256, k, m);

const PRIV = hexToBytes("4c0883a69102937d6231471b5dbb6204fe512961708279f2e3e8a5d4b8e3e3e3");
const OTHER = hexToBytes("5d862374c6a52ef9b9e84e0ba3b3cc9c12bb2b54b2fcb9b3cf84ea5f55b8a1c1");
const OWNER = addressFromPublicKey(secp.getPublicKey(PRIV, false));
const NOW = new Date("2026-11-07T12:00:00.000Z");
const TOKEN = "trientes-ab12cd34";
const CONTRACT = { chain: "ethereum", address: `0x${"a".repeat(40)}` };
const MESSAGE = claimMessage({ slug: "taler", claimant: "dv", token: TOKEN });

function sign(text: string, priv: Uint8Array): string {
  const sig = secp.sign(personalMessageHash(text), priv, { prehash: false, format: "recovered" });
  return `0x${bytesToHex(sig.subarray(1))}${(sig[0] + 27).toString(16).padStart(2, "0")}`;
}

/** Ответ RPC на `owner()`: адрес, выровненный в 32 байта. */
const ownerWord = (address: string) => `0x${address.replace(/^0x/, "").padStart(64, "0")}`;

function rpc(result: unknown): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => (result instanceof Error ? { error: { message: "boom" } } : { result }),
  });
}

describe("claimToken и claimMessage", () => {
  it("токен уникален и узнаваем", () => {
    const a = claimToken();
    expect(a).toMatch(/^trientes-[0-9a-f]{40}$/);
    expect(a).not.toBe(claimToken());
  });

  it("текст вызова детерминирован и содержит токен", () => {
    expect(MESSAGE).toBe(
      `Trientes card ownership claim\ncard: taler\nclaimant: dv\ntoken: ${TOKEN}`,
    );
  });
});

describe("nextTrust и isClaimed", () => {
  it("сверенный контракт поднимает сразу до FULLY_VERIFIED", () => {
    expect(nextTrust(true)).toBe("FULLY_VERIFIED");
    expect(nextTrust(false)).toBe("PROJECT_CLAIMED");
  });

  it("подтверждённую карточку перебить второй заявкой нельзя", () => {
    expect(isClaimed("PROJECT_CLAIMED")).toBe(true);
    expect(isClaimed("FULLY_VERIFIED")).toBe(true);
    expect(isClaimed("CONTRACT_VERIFIED")).toBe(false);
    expect(isClaimed("UNVERIFIED")).toBe(false);
  });
});

describe("canStartClaim", () => {
  const base = {
    trust: "UNVERIFIED",
    method: "DNS_TXT" as const,
    openByUser: 0,
    openByCard: 0,
    domain: "example.com",
    canonicalContract: true,
  };

  it("обычный случай", () => {
    expect(canStartClaim(base)).toEqual({ ok: true });
  });

  it("уже подтверждено", () => {
    expect(canStartClaim({ ...base, trust: "FULLY_VERIFIED" })).toEqual({
      ok: false, reason: "already_claimed",
    });
  });

  it("лимиты заявок", () => {
    expect(canStartClaim({ ...base, openByUser: 3 })).toEqual({ ok: false, reason: "too_many_claims" });
    expect(canStartClaim({ ...base, openByCard: 3 })).toEqual({ ok: false, reason: "too_many_claims" });
  });

  it("домен нужен для DNS и файла, контракт — для подписи", () => {
    expect(canStartClaim({ ...base, domain: null })).toEqual({ ok: false, reason: "no_website" });
    expect(canStartClaim({ ...base, method: "WELL_KNOWN", domain: null })).toEqual({
      ok: false, reason: "no_website",
    });
    expect(canStartClaim({ ...base, method: "OWNER_SIGNATURE", domain: null })).toEqual({ ok: true });
    expect(canStartClaim({ ...base, method: "OWNER_SIGNATURE", canonicalContract: false })).toEqual({
      ok: false, reason: "no_contracts",
    });
  });
});

describe("canCheckClaim", () => {
  const open = {
    status: "PENDING",
    attempts: 0,
    lastTriedAt: null as Date | null,
    expiresAt: new Date(NOW.getTime() + CLAIM_TTL_MS),
  };

  it("открытую заявку проверять можно", () => {
    expect(canCheckClaim(open, NOW)).toEqual({ ok: true });
  });

  it("закрытая, просроченная и исчерпанная", () => {
    expect(canCheckClaim({ ...open, status: "VERIFIED" }, NOW)).toEqual({ ok: false, reason: "claim_closed" });
    expect(canCheckClaim({ ...open, expiresAt: new Date(NOW.getTime() - 1) }, NOW)).toEqual({
      ok: false, reason: "expired",
    });
    expect(canCheckClaim({ ...open, attempts: MAX_ATTEMPTS }, NOW)).toEqual({
      ok: false, reason: "attempts_exhausted",
    });
  });

  it("окно в минуту", () => {
    expect(canCheckClaim({ ...open, lastTriedAt: new Date(NOW.getTime() - 30_000) }, NOW)).toEqual({
      ok: false, reason: "too_soon",
    });
    expect(canCheckClaim({ ...open, lastTriedAt: new Date(NOW.getTime() - 61_000) }, NOW)).toEqual({ ok: true });
  });
});

describe("readContractOwner", () => {
  it("читает адрес владельца", async () => {
    const r = await readContractOwner(CONTRACT, { fetchImpl: rpc(ownerWord(OWNER)) });
    expect(r.owner?.toLowerCase()).toBe(OWNER.toLowerCase());
  });

  it("контракт без owner() — способ недоступен", async () => {
    expect(await readContractOwner(CONTRACT, { fetchImpl: rpc("0x") })).toEqual({
      owner: null, error: "no_owner",
    });
    expect(await readContractOwner(CONTRACT, { fetchImpl: rpc(ownerWord("0".repeat(40))) })).toEqual({
      owner: null, error: "no_owner",
    });
  });

  it("не-EVM сеть и сбой узла", async () => {
    expect(await readContractOwner({ ...CONTRACT, chain: "solana" }, { fetchImpl: rpc("0x") })).toEqual({
      owner: null, error: "chain_unsupported",
    });
    const dead: FetchLike = async () => { throw new Error("down"); };
    expect(await readContractOwner(CONTRACT, { fetchImpl: dead })).toEqual({
      owner: null, error: "owner_unreadable",
    });
  });
});

describe("verifyProof: подпись владельца", () => {
  const input = {
    method: "OWNER_SIGNATURE" as const,
    token: TOKEN,
    message: MESSAGE,
    domain: null,
    contract: CONTRACT,
  };

  it("подпись владельца принимается", async () => {
    const r = await verifyProof(
      { ...input, signature: sign(MESSAGE, PRIV) },
      { fetchImpl: rpc(ownerWord(OWNER)) },
    );
    expect(r).toEqual({ ok: true, target: OWNER.toLowerCase() });
  });

  it("подпись чужого ключа отклоняется", async () => {
    const r = await verifyProof(
      { ...input, signature: sign(MESSAGE, OTHER) },
      { fetchImpl: rpc(ownerWord(OWNER)) },
    );
    expect(r).toEqual({ ok: false, error: "signature_wrong_address" });
  });

  it("подпись другого текста не подходит", async () => {
    const r = await verifyProof(
      { ...input, signature: sign(claimMessage({ slug: "other", claimant: "dv", token: TOKEN }), PRIV) },
      { fetchImpl: rpc(ownerWord(OWNER)) },
    );
    expect(r).toEqual({ ok: false, error: "signature_wrong_address" });
  });

  it("пустая и битая подпись", async () => {
    expect(await verifyProof({ ...input, signature: "" }, { fetchImpl: rpc(ownerWord(OWNER)) })).toEqual({
      ok: false, error: "signature_required",
    });
    expect(await verifyProof({ ...input, signature: "0x1234" }, { fetchImpl: rpc(ownerWord(OWNER)) })).toEqual({
      ok: false, error: "signature_invalid",
    });
  });
});

function domainFetch(handler: (url: string) => unknown): DomainFetch {
  return async (url: string) => {
    const body = handler(url);
    if (body instanceof Error) throw body;
    if (typeof body === "number") {
      return { ok: false, status: body, json: async () => ({}), text: async () => "" };
    }
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  };
}

describe("verifyProof: домен", () => {
  const dns = { method: "DNS_TXT" as const, token: TOKEN, message: MESSAGE, domain: "example.com", contract: null };
  const file = { ...dns, method: "WELL_KNOWN" as const };

  it("TXT-запись с токеном принимается", async () => {
    const r = await verifyProof(dns, {
      domainFetch: domainFetch(() => ({ Answer: [{ type: 16, data: `"${TXT_PREFIX}${TOKEN}"` }] })),
    });
    expect(r).toEqual({ ok: true, target: "example.com" });
  });

  it("чужой токен в TXT не принимается", async () => {
    const r = await verifyProof(dns, {
      domainFetch: domainFetch(() => ({ Answer: [{ type: 16, data: '"trientes-verification=trientes-ffff"' }] })),
    });
    expect(r).toEqual({ ok: false, error: "token_not_found" });
  });

  it("DNS без записей и недоступный резолвер", async () => {
    expect(await verifyProof(dns, { domainFetch: domainFetch(() => ({ Answer: [] })) })).toEqual({
      ok: false, error: "dns_no_record",
    });
    expect(await verifyProof(dns, { domainFetch: domainFetch(() => new Error("x")) })).toEqual({
      ok: false, error: "dns_unreachable",
    });
  });

  it("файл с токеном принимается, 404 — нет", async () => {
    expect(await verifyProof(file, { domainFetch: domainFetch(() => `${TOKEN}\n`) })).toEqual({
      ok: true, target: "example.com",
    });
    expect(await verifyProof(file, { domainFetch: domainFetch(() => 404) })).toEqual({
      ok: false, error: "well_known_missing",
    });
  });

  it("без домена доказательства через домен нет", async () => {
    expect(await verifyProof({ ...dns, domain: null }, {})).toEqual({ ok: false, error: "token_not_found" });
  });
});

describe("expireStaleClaims", () => {
  it("гасит просроченные PENDING", async () => {
    let seen: Record<string, unknown> | null = null;
    const count = await expireStaleClaims({
      prisma: {
        coinCardClaim: {
          updateMany: async (args: unknown) => {
            seen = args as Record<string, unknown>;
            return { count: 2 };
          },
        },
      },
      now: NOW,
    });
    expect(count).toBe(2);
    expect(seen).toMatchObject({
      where: { status: "PENDING", expiresAt: { lt: NOW } },
      data: { status: "EXPIRED" },
    });
  });
});
