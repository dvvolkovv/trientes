import { config } from "dotenv";
config({ path: ".env.local" });

import { compactEncode, fakeSignedExtrinsic } from "@/lib/substrate-extrinsic";
import { jsonRpc } from "@/lib/json-rpc";
import { resolveSubstrateChain, substrateRpcUrlFor } from "@/lib/substrate-chains";

/**
 * Подтверждение индекса палеты балансов для новой сети (слайс V).
 *
 * Простой подбор даёт ложные совпадения: у Polkadot `payment_queryInfo`
 * принимает и 5, и 39, у Creditcoin — и 3, и 18. Поэтому индекс проверяется
 * дважды: у настоящей палеты балансов `transfer_keep_alive` (вызов 3) и
 * `transfer_allow_death` (вызов 0) принимают одни и те же аргументы, значит
 * декодируются оба, и комиссии расходятся на доли процента. У ложного индекса
 * вызов 0 не декодируется вовсе.
 *
 *   tsx scripts/probe-substrate-pallet.ts <ключ сети> [макс. индекс]
 */

const KEEP_ALIVE = 3;
const ALLOW_DEATH = 0;

function callBytes(pallet: number, callIdx: number, value: bigint): Uint8Array {
  const dest = new Uint8Array(32).fill(0x11);
  const amount = compactEncode(value);
  const out = new Uint8Array(3 + dest.length + amount.length);
  out.set([pallet, callIdx, 0x00], 0);
  out.set(dest, 3);
  out.set(amount, 3 + dest.length);
  return out;
}

async function feeFor(
  url: string,
  pallet: number,
  callIdx: number,
  decimals: number,
): Promise<number | null> {
  const value = BigInt(10) ** BigInt(decimals);
  // Набор подписанных расширений у сетей разный: вариант подбирается попыткой,
  // как и в `queryTransferFee`.
  for (const metadataHashMode of [false, true]) {
    try {
      const raw = await jsonRpc(
        url,
        "payment_queryInfo",
        [fakeSignedExtrinsic({ call: callBytes(pallet, callIdx, value), metadataHashMode })],
        { timeoutMs: 15000, retries: 0 },
      );
      const fee = (raw as { partialFee?: string }).partialFee;
      if (typeof fee === "string") return Number(fee) / Number(value);
    } catch {
      // не та палета или не тот набор расширений
    }
  }
  return null;
}

async function main(): Promise<void> {
  const key = process.argv[2];
  const maxIndex = Number(process.argv[3] ?? 40);
  const chain = key ? resolveSubstrateChain(key) : null;
  if (!chain) {
    console.error("укажи ключ сети из реестра substrate-chains");
    process.exit(1);
  }
  const url = substrateRpcUrlFor(chain);
  const props = (await jsonRpc(url, "system_properties", [], { timeoutMs: 15000 })) as {
    tokenDecimals?: number;
  };
  const decimals = props.tokenDecimals ?? 12;
  console.log(`${chain.key} · ${url} · ${decimals} знаков`);

  for (let pallet = 0; pallet <= maxIndex; pallet++) {
    const keep = await feeFor(url, pallet, KEEP_ALIVE, decimals);
    if (keep == null) continue;
    const allow = await feeFor(url, pallet, ALLOW_DEATH, decimals);
    const verdict =
      allow == null
        ? "ЛОЖНЫЙ (вызов 0 не декодируется)"
        : `палета балансов (отношение ${(allow / keep).toFixed(4)})`;
    console.log(`  ${pallet}: keep_alive=${keep} allow_death=${allow} → ${verdict}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
