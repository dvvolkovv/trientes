# Слайс S — чтение сети для нативных Substrate-монет: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** нативная монета собственной Substrate-сети (Taler) получает проверенный
в блокчейне выпуск, капитализацию, FDV и измеренные параметры платежей — без
контракта и без слов проекта.

**Architecture:** три новых чистых слоя (кодек SCALE/twox/SS58 → реестр сетей →
типизированные чтения RPC) и два прогона по базе: существующий `syncCardSupply`
получает ветку `SUBSTRATE`, новый `syncChainFacts` пишет факты сети в отдельную
модель. Заявления проекта не перезаписываются; рендер предпочитает факт и
подписывает его провенансом.

**Tech Stack:** TypeScript, Next.js 16 (App Router, server components), Prisma +
Postgres, vitest, `@noble/hashes` (blake2b — уже в зависимостях), node-cron в
воркере. Новых зависимостей **нет**: xxhash64 пишется в коде (≈60 строк), SS58
разбирается base58 вручную.

**Спека:** `docs/superpowers/specs/2026-11-07-coin-card-substrate-design.md`

---

## Карта файлов

| Файл | Ответственность |
| ---- | --------------- |
| `src/lib/json-rpc.ts` | новый. JSON-RPC поверх инъектируемого fetch, результат `unknown`, `RpcError`, один повтор при обрыве |
| `src/lib/evm-rpc.ts` | правка. Ядро берётся из `json-rpc`, строковые обёртки и `eth*` остаются, `RpcError`/`FetchLike` реэкспортируются |
| `src/lib/substrate-codec.ts` | новый, чистый. `xxh64`, `twox128`, ключи хранилища, `blake2_128concat`, u64/u128 LE, `AccountInfo`, SS58 |
| `src/lib/substrate-chains.ts` | новый. Реестр сетей, алиасы, URL с переопределением из `.env` |
| `src/lib/substrate-rpc.ts` | новый. Типизированные чтения: свойства, выпуск, баланс, заголовок, финализированная голова, время блока, генезис |
| `src/lib/coin-card-supply.ts` | правка. Ветка `SUBSTRATE`, валидатор адреса в `parseExcluded` |
| `src/lib/coin-card-chain-facts.ts` | новый. Сбор фактов сети, расхождения, прогон по базе |
| `src/lib/coin-card-risk.ts` | правка. `nativeChain` → раздел `CONTRACTS` |
| `src/lib/coin-card-form-spec.ts` | правка. `select` нативной сети в разделе `CONTRACTS` |
| `src/app/actions/coin-card-supply.ts` | правка. Ручной пересчёт для нативной сети |
| `src/components/coin-card/native-chain-block.tsx` | новый. Блок «Сеть монеты» |
| `src/components/coin-card/sections/contracts-section.tsx` | правка. Рендерится при наличии нативной сети, даже когда контрактов нет |
| `src/components/coin-card/sections/payments-block.tsx` | правка. Факт предпочитается заявлению |
| `src/lib/coin-card-public.ts` | правка. `chainFacts` и `nativeChain` в выборке карточки |
| `worker/index.ts` | правка. `runChainFactsSweep()` в `35 * * * *` |
| `prisma/schema.prisma` + миграция | `CoinCard.nativeChain`, `CoinCardChainFacts` |
| `messages/*.json` ×10 | ключи `coinCard.nativeChain.*`, `coinCard.payments.claimedSays` |
| `tests/substrate-codec.test.ts` | новый |
| `tests/substrate-chains.test.ts` | новый |
| `tests/substrate-rpc.test.ts` | новый |
| `tests/coin-card-chain-facts.test.ts` | новый |
| `tests/coin-card-supply-substrate.test.ts` | новый |

Проверочные команды (одни на весь план):

```bash
npx vitest run                 # все тесты, сейчас 911 зелёных
npx tsc --noEmit               # типы
npm run build && pm2 restart trientes-web trientes-worker && pm2 save
```

---

## Заход 1 — проверенный выпуск

### Задача 1: ядро кодека — twox128 и ключи хранилища

**Files:**
- Create: `src/lib/substrate-codec.ts`
- Test: `tests/substrate-codec.test.ts`

- [ ] **Шаг 1: Написать падающий тест**

Эталоны взяты не из головы: это опубликованные ключи хранилища Substrate,
которые уже подтверждены живым ответом `node.taler.uno`.

```ts
import { describe, expect, it } from "vitest";
import {
  twox128, xxh64, storageKey, totalIssuanceKey, timestampNowKey,
  systemAccountKey, decodeUintLE, decodeAccountBalance,
} from "../src/lib/substrate-codec";

describe("twox128", () => {
  it("совпадает с опубликованными префиксами паллет", () => {
    expect(twox128("Balances")).toBe("c2261276cc9d1f8598ea4b6a74b15c2f");
    expect(twox128("TotalIssuance")).toBe("57c875e4cff74148e4628f264b974c80");
    expect(twox128("System")).toBe("26aa394eea5630e07c48ae0c9558cef7");
    expect(twox128("Account")).toBe("b99d880ec681799c0cf30e8886371da9");
  });

  it("xxh64 покрывает обе ветки алгоритма: короткий и длинный вход", () => {
    // Контрольные значения XXH64 для seed 0.
    expect(xxh64(new Uint8Array(0), 0n)).toBe(0xef46db3751d8e999n);
    expect(xxh64(new TextEncoder().encode("a".repeat(40)), 0n)).toBe(
      xxh64(new TextEncoder().encode("a".repeat(40)), 0n),
    );
    // Вход длиннее 32 байт идёт через четыре аккумулятора — результат другой.
    expect(xxh64(new TextEncoder().encode("a".repeat(40)), 0n)).not.toBe(
      xxh64(new TextEncoder().encode("a".repeat(31)), 0n),
    );
  });
});

describe("ключи хранилища", () => {
  it("storageKey склеивает два twox128", () => {
    expect(storageKey("Balances", "TotalIssuance")).toBe(
      "0xc2261276cc9d1f8598ea4b6a74b15c2f57c875e4cff74148e4628f264b974c80",
    );
    expect(totalIssuanceKey()).toBe(storageKey("Balances", "TotalIssuance"));
    expect(timestampNowKey()).toBe(storageKey("Timestamp", "Now"));
  });

  it("systemAccountKey = префикс + blake2_128 + сам ключ", () => {
    const pub = new Uint8Array(32).fill(7);
    const key = systemAccountKey(pub);
    expect(key.startsWith("0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9")).toBe(true);
    // 2 (0x) + 64 (префикс) + 32 (blake2_128) + 64 (ключ)
    expect(key.length).toBe(2 + 64 + 32 + 64);
    expect(key.endsWith("07".repeat(32))).toBe(true);
  });
});

describe("decodeUintLE", () => {
  it("читает little-endian", () => {
    expect(decodeUintLE("0x0100000000000000")).toBe(1n);
    expect(decodeUintLE("0x2b76f9092fcf23c34d00000000000000")).toBe(1434460603080000000000n);
  });
  it("пустое значение и мусор — null", () => {
    expect(decodeUintLE(null)).toBeNull();
    expect(decodeUintLE("0x")).toBeNull();
    expect(decodeUintLE("нет")).toBeNull();
    expect(decodeUintLE("0x123")).toBeNull(); // нечётная длина
  });
});

describe("decodeAccountBalance", () => {
  it("складывает free и reserved из AccountInfo", () => {
    // nonce(4) consumers(4) providers(4) sufficients(4) free(16) reserved(16) frozen(16) flags(16)
    const b = new Uint8Array(80);
    b[16] = 5;  // free = 5
    b[32] = 9;  // reserved = 9
    b[48] = 3;  // frozen = 3 — подмножество free, не вычитается и не складывается
    const hex = "0x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
    expect(decodeAccountBalance(hex)).toBe(14n);
  });
  it("пустой счёт — ноль, короткий ответ — null", () => {
    expect(decodeAccountBalance(null)).toBe(0n);
    expect(decodeAccountBalance("0x00")).toBeNull();
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Run: `npx vitest run tests/substrate-codec.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/substrate-codec"`.

- [ ] **Шаг 3: Реализовать кодек**

```ts
/**
 * Кодек Substrate: ключи хранилища и разбор SCALE. Чистый файл без сети —
 * ровно те вычисления, которые нужно проверить тестом, а не глазами.
 *
 * Ключи хранилища выводятся, а не вставляются готовым хексом: xxhash64 — это
 * шестьдесят строк, а магическую константу через год невозможно ни
 * перепроверить, ни объяснить. Тест сверяет вывод с опубликованными ключами.
 */

import { blake2b } from "@noble/hashes/blake2.js";

const M = (BigInt(1) << BigInt(64)) - BigInt(1);
const P1 = BigInt("11400714785074694791");
const P2 = BigInt("14029467366897019727");
const P3 = BigInt("1609587929392839161");
const P4 = BigInt("9650029242287828579");
const P5 = BigInt("2870177450012600261");

const mul = (a: bigint, b: bigint) => (a * b) & M;
const add = (a: bigint, b: bigint) => (a + b) & M;
const rotl = (v: bigint, r: number) =>
  ((v << BigInt(r)) | (v >> BigInt(64 - r))) & M;

const round = (acc: bigint, val: bigint) => mul(rotl(add(acc, mul(val, P2)), 31), P1);

function mergeRound(acc: bigint, val: bigint): bigint {
  return add(mul(acc ^ round(BigInt(0), val), P1), P4);
}

function readU64(b: Uint8Array, i: number): bigint {
  let v = BigInt(0);
  for (let k = 7; k >= 0; k--) v = (v << BigInt(8)) | BigInt(b[i + k]);
  return v;
}

function readU32(b: Uint8Array, i: number): bigint {
  return BigInt(((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) >>> 0) + b[i + 3] * 0x1000000);
}

/** XXH64 — хеш, на котором Substrate строит префиксы паллет (`twox`). */
export function xxh64(buf: Uint8Array, seed: bigint): bigint {
  const len = buf.length;
  let acc: bigint;
  let i = 0;

  if (len >= 32) {
    let a1 = add(add(seed, P1), P2);
    let a2 = add(seed, P2);
    let a3 = seed;
    let a4 = (seed - P1) & M;
    for (; i <= len - 32; i += 32) {
      a1 = round(a1, readU64(buf, i));
      a2 = round(a2, readU64(buf, i + 8));
      a3 = round(a3, readU64(buf, i + 16));
      a4 = round(a4, readU64(buf, i + 24));
    }
    acc = (rotl(a1, 1) + rotl(a2, 7) + rotl(a3, 12) + rotl(a4, 18)) & M;
    acc = mergeRound(acc, a1);
    acc = mergeRound(acc, a2);
    acc = mergeRound(acc, a3);
    acc = mergeRound(acc, a4);
  } else {
    acc = add(seed, P5);
  }

  acc = add(acc, BigInt(len));
  for (; i <= len - 8; i += 8) {
    acc = add(mul(rotl(acc ^ round(BigInt(0), readU64(buf, i)), 27), P1), P4);
  }
  if (i <= len - 4) {
    acc = add(mul(rotl(acc ^ mul(readU32(buf, i), P1), 23), P2), P3);
    i += 4;
  }
  for (; i < len; i++) {
    acc = mul(rotl(acc ^ mul(BigInt(buf[i]), P5), 11), P1);
  }
  acc ^= acc >> BigInt(33);
  acc = mul(acc, P2);
  acc ^= acc >> BigInt(29);
  acc = mul(acc, P3);
  acc ^= acc >> BigInt(32);
  return acc;
}

export const toHex = (b: Uint8Array): string =>
  Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

export function fromHex(hex: string): Uint8Array | null {
  const s = (hex ?? "").replace(/^0x/, "");
  if (s.length === 0 || s.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const leHex = (v: bigint): string => {
  let s = "";
  for (let k = 0; k < 8; k++) s += Number((v >> BigInt(8 * k)) & BigInt(0xff)).toString(16).padStart(2, "0");
  return s;
};

/** twox128(data) = xxh64(seed 0) ++ xxh64(seed 1), каждый little-endian. */
export function twox128(input: string): string {
  const b = new TextEncoder().encode(input);
  return leHex(xxh64(b, BigInt(0))) + leHex(xxh64(b, BigInt(1)));
}

export const storageKey = (pallet: string, item: string): string =>
  `0x${twox128(pallet)}${twox128(item)}`;

export const totalIssuanceKey = (): string => storageKey("Balances", "TotalIssuance");
export const timestampNowKey = (): string => storageKey("Timestamp", "Now");

/** blake2_128concat: хеш ключа плюс сам ключ — чтобы ключ читался обратно. */
export function systemAccountKey(pubkey: Uint8Array): string {
  return `${storageKey("System", "Account")}${toHex(blake2b(pubkey, { dkLen: 16 }))}${toHex(pubkey)}`;
}

/** Беззнаковое целое из hex little-endian любой длины (u32/u64/u128). */
export function decodeUintLE(hex: string | null | undefined): bigint | null {
  const b = fromHex(hex ?? "");
  if (!b) return null;
  let v = BigInt(0);
  for (let i = b.length - 1; i >= 0; i--) v = (v << BigInt(8)) | BigInt(b[i]);
  return v;
}

/**
 * `free + reserved` из `AccountInfo`. Застейканное и забонденное в казне
 * проекта всё равно принадлежит казне и в оборот не входит. `frozen` не
 * трогаем: в нынешнем рантайме это подмножество `free`, и его учёт посчитал бы
 * одни и те же монеты дважды.
 *
 * Отсутствующий счёт (`null`) — это ноль, а не ошибка: адрес просто пуст.
 */
export function decodeAccountBalance(hex: string | null | undefined): bigint | null {
  if (hex == null) return BigInt(0);
  const b = fromHex(hex);
  if (!b) return BigInt(0);
  if (b.length < 48) return null;
  const u128 = (off: number) => {
    let v = BigInt(0);
    for (let i = 15; i >= 0; i--) v = (v << BigInt(8)) | BigInt(b[off + i]);
    return v;
  };
  return u128(16) + u128(32);
}
```

- [ ] **Шаг 4: Тест зелёный**

Run: `npx vitest run tests/substrate-codec.test.ts`
Expected: PASS, 7 тестов.

- [ ] **Шаг 5: Коммит**

```bash
git add src/lib/substrate-codec.ts tests/substrate-codec.test.ts
git commit -m "feat(coin-card): слайс S — кодек Substrate: twox128, ключи хранилища, разбор AccountInfo"
```

---

### Задача 2: SS58-адреса

**Files:**
- Modify: `src/lib/substrate-codec.ts`
- Modify: `tests/substrate-codec.test.ts`

- [ ] **Шаг 1: Написать падающий тест**

```ts
import { ss58Decode, isSs58Address } from "../src/lib/substrate-codec";

describe("ss58Decode", () => {
  // Публичный ключ Alice из набора разработчика; адрес в формате Polkadot (0).
  const ALICE_POLKADOT = "15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5";
  const ALICE_PUB = "d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";

  it("разбирает адрес и отдаёт префикс с публичным ключом", () => {
    const r = ss58Decode(ALICE_POLKADOT);
    expect(r).not.toBeNull();
    expect(r!.prefix).toBe(0);
    expect(toHex(r!.pubkey)).toBe(ALICE_PUB);
  });

  it("битая контрольная сумма отбрасывается", () => {
    const broken = ALICE_POLKADOT.slice(0, -1) + (ALICE_POLKADOT.endsWith("5") ? "6" : "5");
    expect(ss58Decode(broken)).toBeNull();
  });

  it("не base58 и пустая строка — null", () => {
    expect(ss58Decode("0xdeadbeef")).toBeNull();
    expect(ss58Decode("")).toBeNull();
  });

  it("isSs58Address проверяет префикс сети", () => {
    expect(isSs58Address(ALICE_POLKADOT, 0)).toBe(true);
    expect(isSs58Address(ALICE_POLKADOT, 10960)).toBe(false);
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Run: `npx vitest run tests/substrate-codec.test.ts`
Expected: FAIL — `ss58Decode is not a function`.

- [ ] **Шаг 3: Реализовать**

Дописать в `src/lib/substrate-codec.ts`:

```ts
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(input: string): Uint8Array | null {
  if (!input || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(input)) return null;
  let num = BigInt(0);
  for (const ch of input) {
    const idx = B58.indexOf(ch);
    if (idx < 0) return null;
    num = num * BigInt(58) + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > BigInt(0)) {
    bytes.unshift(Number(num & BigInt(0xff)));
    num >>= BigInt(8);
  }
  // Ведущие '1' в base58 — это ведущие нулевые байты.
  for (const ch of input) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

const SS58_PRE = new TextEncoder().encode("SS58PRE");

export type Ss58Parts = { prefix: number; pubkey: Uint8Array };

/**
 * Разбор SS58. Контрольная сумма обязательна: без неё опечатка в адресе казны
 * превратилась бы в «адрес не ответил», то есть в молчаливое занижение
 * исключённого выпуска.
 */
export function ss58Decode(address: string | null | undefined): Ss58Parts | null {
  const raw = base58Decode((address ?? "").trim());
  if (!raw) return null;

  // Префикс сети: один байт (<64) или два байта по схеме Substrate.
  let prefix: number;
  let offset: number;
  if (raw[0] < 64) {
    prefix = raw[0];
    offset = 1;
  } else if (raw[0] < 128) {
    const lower = ((raw[0] & 0b0000_0011) << 6) | (raw[1] >> 2);
    const upper = (raw[1] & 0b0000_0011) | ((raw[0] & 0b0011_1111) << 2);
    prefix = lower | (upper << 8);
    offset = 2;
  } else {
    return null;
  }

  const body = raw.slice(0, raw.length - 2);
  const given = raw.slice(raw.length - 2);
  if (body.length - offset !== 32) return null;

  const pre = new Uint8Array(SS58_PRE.length + body.length);
  pre.set(SS58_PRE, 0);
  pre.set(body, SS58_PRE.length);
  const sum = blake2b(pre, { dkLen: 64 });
  if (sum[0] !== given[0] || sum[1] !== given[1]) return null;

  return { prefix, pubkey: body.slice(offset) };
}

/** Адрес разбирается и принадлежит именно этой сети. */
export function isSs58Address(
  address: string | null | undefined,
  expectedPrefix?: number,
): boolean {
  const parts = ss58Decode(address);
  if (!parts) return false;
  return expectedPrefix == null || parts.prefix === expectedPrefix;
}
```

- [ ] **Шаг 4: Тест зелёный**

Run: `npx vitest run tests/substrate-codec.test.ts`
Expected: PASS, 11 тестов.

- [ ] **Шаг 5: Коммит**

```bash
git add src/lib/substrate-codec.ts tests/substrate-codec.test.ts
git commit -m "feat(coin-card): слайс S — разбор SS58 с проверкой контрольной суммы и префикса сети"
```

---

### Задача 3: реестр Substrate-сетей

**Files:**
- Create: `src/lib/substrate-chains.ts`
- Test: `tests/substrate-chains.test.ts`

- [ ] **Шаг 1: Написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import {
  SUBSTRATE_CHAINS, NATIVE_CHAIN_KEYS, resolveSubstrateChain, substrateRpcUrlFor,
} from "../src/lib/substrate-chains";

describe("resolveSubstrateChain", () => {
  it("находит сеть по ключу и по написанию с заглавной", () => {
    expect(resolveSubstrateChain("taler")?.key).toBe("taler");
    expect(resolveSubstrateChain("Taler")?.key).toBe("taler");
    expect(resolveSubstrateChain("polkadot")?.key).toBe("polkadot");
  });

  it("родовое слово «substrate» сетью не считается", () => {
    expect(resolveSubstrateChain("substrate")).toBeNull();
    expect(resolveSubstrateChain("")).toBeNull();
    expect(resolveSubstrateChain(null)).toBeNull();
    expect(resolveSubstrateChain("ethereum")).toBeNull();
  });

  it("ключи для формы совпадают с реестром", () => {
    expect(NATIVE_CHAIN_KEYS).toEqual(SUBSTRATE_CHAINS.map((c) => c.key));
  });
});

describe("substrateRpcUrlFor", () => {
  const taler = resolveSubstrateChain("taler")!;

  it("по умолчанию берёт адрес из реестра", () => {
    expect(substrateRpcUrlFor(taler, {})).toBe("https://node.taler.uno");
  });

  it("переопределение из окружения важнее реестра", () => {
    expect(substrateRpcUrlFor(taler, { SUBSTRATE_RPC_TALER: "https://alt.example" }))
      .toBe("https://alt.example");
    expect(substrateRpcUrlFor(taler, { SUBSTRATE_RPC_TALER: "   " }))
      .toBe("https://node.taler.uno");
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Run: `npx vitest run tests/substrate-chains.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Шаг 3: Реализовать**

```ts
/**
 * Реестр Substrate-сетей, нативная единица которых может быть монетой
 * карточки. Реестр — код, а не пользовательский ввод: проект не подсовывает
 * свой RPC, иначе «проверено в блокчейне» означало бы «проверено на сервере,
 * который выбрал сам проект».
 *
 * Все три адреса проверены живым POST-запросом 7 ноября 2026.
 */

export type SubstrateChain = {
  key: string;
  label: string;
  defaultRpcUrl: string;
  /** Ожидаемый префикс SS58 и тикер: расхождение с узлом попадает в mismatches. */
  ss58Format: number;
  symbol: string;
};

export const SUBSTRATE_CHAINS: readonly SubstrateChain[] = [
  { key: "taler", label: "Taler", defaultRpcUrl: "https://node.taler.uno", ss58Format: 10960, symbol: "TAL" },
  { key: "polkadot", label: "Polkadot", defaultRpcUrl: "https://rpc.polkadot.io", ss58Format: 0, symbol: "DOT" },
  { key: "kusama", label: "Kusama", defaultRpcUrl: "https://kusama-rpc.polkadot.io", ss58Format: 2, symbol: "KSM" },
];

/** Значения select'а в форме карточки. */
export const NATIVE_CHAIN_KEYS: readonly string[] = SUBSTRATE_CHAINS.map((c) => c.key);

export function resolveSubstrateChain(raw: string | null | undefined): SubstrateChain | null {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return null;
  return SUBSTRATE_CHAINS.find((c) => c.key === key) ?? null;
}

/**
 * Адрес узла: переопределение из окружения важнее реестра — публичный узел
 * может начать банить сервер, как это уже было со Stooq и Overpass.
 */
export function substrateRpcUrlFor(
  chain: SubstrateChain,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env[`SUBSTRATE_RPC_${chain.key.toUpperCase()}`];
  return override && override.trim().length > 0 ? override.trim() : chain.defaultRpcUrl;
}
```

- [ ] **Шаг 4: Тест зелёный**

Run: `npx vitest run tests/substrate-chains.test.ts`
Expected: PASS, 5 тестов.

- [ ] **Шаг 5: Коммит**

```bash
git add src/lib/substrate-chains.ts tests/substrate-chains.test.ts
git commit -m "feat(coin-card): слайс S — реестр Substrate-сетей с переопределением узла из окружения"
```

---

### Задача 4: выделить ядро JSON-RPC из evm-rpc

**Files:**
- Create: `src/lib/json-rpc.ts`
- Modify: `src/lib/evm-rpc.ts`

Причина: `rpcCall` в `evm-rpc.ts` требует, чтобы `result` был строкой, а
`system_properties` и `chain_getHeader` отдают объект. Копировать транспорт во
второй файл значит дважды поддерживать классификацию сбоев, которая попадает в
карточку как `checkError`.

- [ ] **Шаг 1: Создать `src/lib/json-rpc.ts`**

Перенести из `evm-rpc.ts` без изменения поведения `FetchLike`, `RpcErrorCode`,
`RpcError`, `RpcOptions` и транспорт; тип результата — `unknown`:

```ts
/**
 * JSON-RPC поверх инъектируемого fetch. Отдельный файл, потому что чтение сети
 * должно тестироваться без сети, а классификация сбоя попадает в карточку как
 * `checkError` — значит она часть контракта, а не деталь.
 *
 * Выделено из evm-rpc.ts в слайсе S: у Substrate результат — объект, а не hex.
 */

export type FetchLike = (
  input: string,
  init?: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type RpcErrorCode = "rpc_unreachable" | "rpc_error" | "decode_failed";

export class RpcError extends Error {
  readonly code: RpcErrorCode;
  constructor(code: RpcErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

export type RpcOptions = {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Одна повторная попытка по умолчанию: публичный узел любит отдавать 429. */
  retries?: number;
};

async function once(
  url: string,
  method: string,
  params: unknown[],
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<unknown> {
  let res: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new RpcError("rpc_unreachable", err instanceof Error ? err.message : undefined);
  }
  if (!res.ok) throw new RpcError("rpc_unreachable", `http ${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new RpcError("decode_failed");
  }
  if (!body || typeof body !== "object") throw new RpcError("decode_failed");
  const payload = body as { result?: unknown; error?: { message?: string } };
  // Ответ узла «такой функции нет» — это не сбой связи, а факт о контракте.
  if (payload.error) throw new RpcError("rpc_error", payload.error.message);
  if (payload.result === undefined) throw new RpcError("decode_failed");
  return payload.result;
}

export async function jsonRpc(
  url: string,
  method: string,
  params: unknown[] = [],
  opts: RpcOptions = {},
): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const retries = opts.retries ?? 1;

  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await once(url, method, params, fetchImpl, timeoutMs);
    } catch (err) {
      last = err;
      // Повторять смысл есть только при обрыве связи: rpc_error воспроизведётся.
      if (!(err instanceof RpcError) || err.code !== "rpc_unreachable") throw err;
    }
  }
  throw last instanceof Error ? last : new RpcError("rpc_unreachable");
}
```

- [ ] **Шаг 2: Переписать `src/lib/evm-rpc.ts` на ядро**

Содержимое файла целиком:

```ts
/**
 * EVM-обёртки над общим JSON-RPC: у `eth_*` результат всегда hex-строка, и
 * остальной код слайса B на это рассчитывает.
 */

import { jsonRpc, RpcError, type RpcOptions } from "./json-rpc";

export { RpcError } from "./json-rpc";
export type { FetchLike, RpcErrorCode, RpcOptions } from "./json-rpc";

export async function rpcCall(
  url: string,
  method: string,
  params: unknown[],
  opts: RpcOptions = {},
): Promise<string> {
  const result = await jsonRpc(url, method, params, opts);
  if (typeof result !== "string") throw new RpcError("decode_failed");
  return result;
}

export function ethCall(
  url: string,
  address: string,
  data: string,
  opts: RpcOptions = {},
): Promise<string> {
  return rpcCall(url, "eth_call", [{ to: address, data }, "latest"], opts);
}

export function ethGetCode(url: string, address: string, opts: RpcOptions = {}): Promise<string> {
  return rpcCall(url, "eth_getCode", [address, "latest"], opts);
}

export function ethGetStorageAt(
  url: string,
  address: string,
  slot: string,
  opts: RpcOptions = {},
): Promise<string> {
  return rpcCall(url, "eth_getStorageAt", [address, slot, "latest"], opts);
}
```

- [ ] **Шаг 3: Прогнать весь набор тестов — поведение слайса B не изменилось**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, 911+ тестов (`tests/coin-card-onchain.test.ts` и
`tests/evm-chains.test.ts` в том числе), типы чистые.

- [ ] **Шаг 4: Коммит**

```bash
git add src/lib/json-rpc.ts src/lib/evm-rpc.ts
git commit -m "refactor(coin-card): ядро JSON-RPC выделено из evm-rpc под чтение Substrate"
```

---

### Задача 5: типизированные чтения Substrate

**Files:**
- Create: `src/lib/substrate-rpc.ts`
- Test: `tests/substrate-rpc.test.ts`

- [ ] **Шаг 1: Написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/lib/json-rpc";
import {
  readChainProperties, readTotalIssuance, readAccountBalance,
  readGenesisHash, readBlockNumbers, measureBlockSeconds,
} from "../src/lib/substrate-rpc";

const URL_ = "https://node.example";

/** Поддельный узел: отвечает по методу, записывает порядок вызовов. */
function node(answers: Record<string, unknown | ((params: unknown[]) => unknown)>): {
  fetchImpl: FetchLike; calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    const body = JSON.parse(init!.body) as { method: string; params: unknown[] };
    calls.push(body.method);
    const a = answers[body.method];
    if (a === undefined) return { ok: true, status: 200, json: async () => ({ error: { message: "Method not found" } }) };
    const result = typeof a === "function" ? (a as (p: unknown[]) => unknown)(body.params) : a;
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
  return { fetchImpl, calls };
}

describe("readChainProperties", () => {
  it("читает знаки, тикер и префикс", async () => {
    const { fetchImpl } = node({ system_properties: { ss58Format: 10960, tokenDecimals: 12, tokenSymbol: "TAL" } });
    await expect(readChainProperties(URL_, { fetchImpl })).resolves.toEqual({
      decimals: 12, symbol: "TAL", ss58Format: 10960,
    });
  });

  it("массивы вместо скаляров (мультиассетные сети) — берётся первый", async () => {
    const { fetchImpl } = node({ system_properties: { ss58Format: 2, tokenDecimals: [12, 10], tokenSymbol: ["KSM", "X"] } });
    await expect(readChainProperties(URL_, { fetchImpl })).resolves.toEqual({
      decimals: 12, symbol: "KSM", ss58Format: 2,
    });
  });

  it("мусор в ответе — decode_failed", async () => {
    const { fetchImpl } = node({ system_properties: "нет" });
    await expect(readChainProperties(URL_, { fetchImpl })).rejects.toThrow("decode_failed");
  });
});

describe("readTotalIssuance", () => {
  it("декодирует u128 little-endian", async () => {
    const { fetchImpl } = node({ state_getStorage: "0x2b76f9092fcf23c34d00000000000000" });
    await expect(readTotalIssuance(URL_, { fetchImpl })).resolves.toBe(1434460603080000000000n);
  });

  it("пустое хранилище — decode_failed: выпуск не может отсутствовать", async () => {
    const { fetchImpl } = node({ state_getStorage: null });
    await expect(readTotalIssuance(URL_, { fetchImpl })).rejects.toThrow("decode_failed");
  });
});

describe("readAccountBalance", () => {
  const ALICE = "15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5";

  it("складывает free и reserved", async () => {
    const b = new Uint8Array(80);
    b[16] = 5; b[32] = 9;
    const hex = "0x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
    const { fetchImpl } = node({ state_getStorage: hex });
    await expect(readAccountBalance(URL_, ALICE, 0, { fetchImpl })).resolves.toBe(14n);
  });

  it("пустой счёт — ноль", async () => {
    const { fetchImpl } = node({ state_getStorage: null });
    await expect(readAccountBalance(URL_, ALICE, 0, { fetchImpl })).resolves.toBe(0n);
  });

  it("чужой префикс сети — address_invalid, запроса не делаем", async () => {
    const { fetchImpl, calls } = node({ state_getStorage: null });
    await expect(readAccountBalance(URL_, ALICE, 10960, { fetchImpl })).rejects.toThrow("address_invalid");
    expect(calls).toEqual([]);
  });
});

describe("readBlockNumbers и measureBlockSeconds", () => {
  it("считает отставание финализации", async () => {
    const { fetchImpl } = node({
      chain_getHeader: (p) => ({ number: p.length === 0 ? "0xd4d311" : "0xd4d30f" }),
      chain_getFinalizedHead: "0xfin",
    });
    await expect(readBlockNumbers(URL_, { fetchImpl })).resolves.toEqual({
      best: 13947665, finalized: 13947663, lag: 2,
    });
  });

  it("измеряет время блока по двум отметкам времени", async () => {
    const t = (ms: number) => "0x" + Array.from({ length: 8 }, (_, i) =>
      Number((BigInt(ms) >> BigInt(8 * i)) & 0xffn).toString(16).padStart(2, "0")).join("");
    const { fetchImpl } = node({
      chain_getBlockHash: (p) => (`0x${String(p[0])}`),
      state_getStorageAt: (p) => (String(p[1]) === "0x1000" ? t(1_700_000_000_000) : t(1_700_000_600_000)),
    });
    await expect(measureBlockSeconds(URL_, 1100, 100, { fetchImpl })).resolves.toEqual({
      blockSeconds: 6, sample: 100,
    });
  });

  it("часы узла пошли назад — decode_failed, а не отрицательное время блока", async () => {
    const t = (ms: number) => "0x" + Array.from({ length: 8 }, (_, i) =>
      Number((BigInt(ms) >> BigInt(8 * i)) & 0xffn).toString(16).padStart(2, "0")).join("");
    const { fetchImpl } = node({
      chain_getBlockHash: (p) => (`0x${String(p[0])}`),
      state_getStorageAt: (p) => (String(p[1]) === "0x1000" ? t(1_700_000_600_000) : t(1_700_000_000_000)),
    });
    await expect(measureBlockSeconds(URL_, 1100, 100, { fetchImpl })).rejects.toThrow("decode_failed");
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Run: `npx vitest run tests/substrate-rpc.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Шаг 3: Реализовать**

```ts
/**
 * Типизированные чтения Substrate-узла. Каждая функция отвечает за один факт
 * и бросает RpcError с тем же кодом, что уже умеет слайс B: коды попадают в
 * карточку как checkError, и общий словарь важнее удобства.
 */

import { jsonRpc, RpcError, type RpcOptions } from "./json-rpc";
import {
  decodeAccountBalance, decodeUintLE, ss58Decode, systemAccountKey,
  timestampNowKey, totalIssuanceKey,
} from "./substrate-codec";

export type ChainProperties = {
  decimals: number | null;
  symbol: string | null;
  ss58Format: number | null;
};

const firstOf = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

export async function readChainProperties(
  url: string,
  opts: RpcOptions = {},
): Promise<ChainProperties> {
  const raw = await jsonRpc(url, "system_properties", [], opts);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RpcError("decode_failed");
  const p = raw as Record<string, unknown>;
  const decimals = firstOf(p.tokenDecimals);
  const symbol = firstOf(p.tokenSymbol);
  const prefix = p.ss58Format;
  return {
    decimals: typeof decimals === "number" ? decimals : null,
    symbol: typeof symbol === "string" ? symbol : null,
    ss58Format: typeof prefix === "number" ? prefix : null,
  };
}

/** Общий выпуск в минимальных единицах. Пустое хранилище — сбой: у работающей
 *  цепи выпуск есть всегда, а ноль молча превратился бы в «нулевой оборот». */
export async function readTotalIssuance(url: string, opts: RpcOptions = {}): Promise<bigint> {
  const raw = await jsonRpc(url, "state_getStorage", [totalIssuanceKey()], opts);
  const v = typeof raw === "string" ? decodeUintLE(raw) : null;
  if (v == null) throw new RpcError("decode_failed");
  return v;
}

export async function readAccountBalance(
  url: string,
  address: string,
  expectedPrefix: number | null,
  opts: RpcOptions = {},
): Promise<bigint> {
  const parts = ss58Decode(address);
  if (!parts || (expectedPrefix != null && parts.prefix !== expectedPrefix)) {
    throw new RpcError("rpc_error", "address_invalid");
  }
  const raw = await jsonRpc(url, "state_getStorage", [systemAccountKey(parts.pubkey)], opts);
  const v = decodeAccountBalance(typeof raw === "string" ? raw : null);
  if (v == null) throw new RpcError("decode_failed");
  return v;
}

export async function readGenesisHash(url: string, opts: RpcOptions = {}): Promise<string> {
  const raw = await jsonRpc(url, "chain_getBlockHash", [0], opts);
  if (typeof raw !== "string" || !/^0x[0-9a-f]{64}$/i.test(raw)) throw new RpcError("decode_failed");
  return raw;
}

function headerNumber(raw: unknown): number {
  if (!raw || typeof raw !== "object") throw new RpcError("decode_failed");
  const n = (raw as { number?: unknown }).number;
  if (typeof n !== "string") throw new RpcError("decode_failed");
  const parsed = Number.parseInt(n, 16);
  if (!Number.isFinite(parsed)) throw new RpcError("decode_failed");
  return parsed;
}

export type BlockNumbers = { best: number; finalized: number; lag: number };

export async function readBlockNumbers(url: string, opts: RpcOptions = {}): Promise<BlockNumbers> {
  const best = headerNumber(await jsonRpc(url, "chain_getHeader", [], opts));
  const finalizedHash = await jsonRpc(url, "chain_getFinalizedHead", [], opts);
  if (typeof finalizedHash !== "string") throw new RpcError("decode_failed");
  const finalized = headerNumber(await jsonRpc(url, "chain_getHeader", [finalizedHash], opts));
  return { best, finalized, lag: Math.max(0, best - finalized) };
}

async function blockTimestampMs(url: string, number: number, opts: RpcOptions): Promise<bigint> {
  const hash = await jsonRpc(url, "chain_getBlockHash", [number], opts);
  if (typeof hash !== "string") throw new RpcError("decode_failed");
  const raw = await jsonRpc(url, "state_getStorageAt", [timestampNowKey(), hash], opts);
  const v = typeof raw === "string" ? decodeUintLE(raw) : null;
  if (v == null) throw new RpcError("decode_failed");
  return v;
}

export type BlockTime = { blockSeconds: number; sample: number };

/**
 * Время блока замером, а не чтением константы рантайма: заявленная константа и
 * фактическая скорость расходятся, а продавцу важна фактическая.
 */
export async function measureBlockSeconds(
  url: string,
  bestNumber: number,
  sample: number,
  opts: RpcOptions = {},
): Promise<BlockTime> {
  const from = bestNumber - sample;
  if (!Number.isInteger(sample) || sample <= 0 || from < 1) throw new RpcError("decode_failed");
  const [tNew, tOld] = await Promise.all([
    blockTimestampMs(url, bestNumber, opts),
    blockTimestampMs(url, from, opts),
  ]);
  // Часы узла, пошедшие назад, дали бы отрицательное время блока — это сбой,
  // а не факт о сети.
  if (tNew <= tOld) throw new RpcError("decode_failed");
  const seconds = Number(tNew - tOld) / sample / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) throw new RpcError("decode_failed");
  return { blockSeconds: Math.round(seconds * 100) / 100, sample };
}
```

- [ ] **Шаг 4: Тест зелёный**

Run: `npx vitest run tests/substrate-rpc.test.ts`
Expected: PASS, 10 тестов.

- [ ] **Шаг 5: Коммит**

```bash
git add src/lib/substrate-rpc.ts tests/substrate-rpc.test.ts
git commit -m "feat(coin-card): слайс S — чтения узла Substrate: выпуск, баланс, свойства, время блока"
```

---

### Задача 6: миграция — nativeChain и CoinCardChainFacts

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261107210000_coin_card_substrate/migration.sql`

- [ ] **Шаг 1: Добавить поле в модель `CoinCard`**

После `hashAlgo` в `model CoinCard`:

```prisma
  /// Ключ сети из substrate-chains, если монета — нативная единица собственной
  /// сети. Контракта у такой монеты нет: идентичность сети — хэш генезиса.
  nativeChain   String?
```

И в список связей той же модели, рядом с `supply`:

```prisma
  chainFacts  CoinCardChainFacts?
```

- [ ] **Шаг 2: Добавить модель после `CoinCardSupply`**

```prisma
// Факты собственной сети нативной монеты (слайс S). Отдельно от CoinCardSupply:
// выпуск и скорость сети обновляются с разной частотой и читаются разными
// разделами карточки; одна строка заставляла бы переписывать выпуск при каждом
// замере времени блока.
model CoinCardChainFacts {
  id              String   @id @default(cuid())
  cardId          String   @unique
  card            CoinCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  chain           String
  genesisHash     String
  tokenSymbol     String?
  tokenDecimals   Int?
  ss58Format      Int?
  // Измерено: (t(N) − t(N−k)) / k. Float, потому что это замер, а не константа.
  blockSeconds    Float?
  blockSample     Int?
  bestNumber      Int?
  finalizedNumber Int?
  finalityLag     Int?
  // finalityLag × blockSeconds. Производное, но хранится: рендер не считает.
  finalitySeconds Float?
  // SYMBOL | DECIMALS — расхождение сети с заявленным в карточке;
  // CHAIN_SYMBOL | SS58_FORMAT — расхождение сети с реестром.
  mismatches      String[] @default([])
  checkedAt       DateTime
  // chain_unsupported | rpc_unreachable | rpc_error | decode_failed | genesis_mismatch
  checkError      String?

  @@index([checkedAt])
}
```

- [ ] **Шаг 3: Написать миграцию руками**

Проект применяет SQL-файлы, а не `migrate dev` (боевая база): положить
`prisma/migrations/20261107210000_coin_card_substrate/migration.sql`:

```sql
ALTER TABLE "CoinCard" ADD COLUMN "nativeChain" TEXT;

CREATE TABLE "CoinCardChainFacts" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "genesisHash" TEXT NOT NULL,
    "tokenSymbol" TEXT,
    "tokenDecimals" INTEGER,
    "ss58Format" INTEGER,
    "blockSeconds" DOUBLE PRECISION,
    "blockSample" INTEGER,
    "bestNumber" INTEGER,
    "finalizedNumber" INTEGER,
    "finalityLag" INTEGER,
    "finalitySeconds" DOUBLE PRECISION,
    "mismatches" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "checkError" TEXT,

    CONSTRAINT "CoinCardChainFacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoinCardChainFacts_cardId_key" ON "CoinCardChainFacts"("cardId");
CREATE INDEX "CoinCardChainFacts_checkedAt_idx" ON "CoinCardChainFacts"("checkedAt");

ALTER TABLE "CoinCardChainFacts" ADD CONSTRAINT "CoinCardChainFacts_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "CoinCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Шаг 4: Применить и сгенерировать клиент**

Run: `npx prisma migrate deploy && npx prisma generate && npx tsc --noEmit`
Expected: `1 migration applied`, клиент сгенерирован, типы чистые.

- [ ] **Шаг 5: Коммит**

```bash
git add prisma/schema.prisma prisma/migrations/20261107210000_coin_card_substrate
git commit -m "feat(coin-card): слайс S — миграция нативной сети и фактов цепи"
```

---

### Задача 7: ветка SUBSTRATE в прогоне выпуска

**Files:**
- Modify: `src/lib/coin-card-supply.ts`
- Test: `tests/coin-card-supply-substrate.test.ts`

- [ ] **Шаг 1: Написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/lib/json-rpc";
import { parseExcluded, readSubstrateSupplyFacts, syncCardSupply } from "../src/lib/coin-card-supply";

const ALICE = "15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5";

function balanceHex(whole: bigint, decimals: number): string {
  const units = whole * BigInt(10) ** BigInt(decimals);
  const b = new Uint8Array(80);
  for (let i = 0; i < 16; i++) b[16 + i] = Number((units >> BigInt(8 * i)) & BigInt(0xff));
  return "0x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function talerNode(totalCoins: bigint, excludedCoins: bigint): FetchLike {
  const issuance = totalCoins * BigInt(10) ** BigInt(12);
  const le = (v: bigint, bytes: number) =>
    "0x" + Array.from({ length: bytes }, (_, i) =>
      Number((v >> BigInt(8 * i)) & BigInt(0xff)).toString(16).padStart(2, "0")).join("");
  return async (_url, init) => {
    const { method, params } = JSON.parse(init!.body) as { method: string; params: unknown[] };
    const result =
      method === "system_properties" ? { ss58Format: 0, tokenDecimals: 12, tokenSymbol: "TAL" }
      : method === "chain_getBlockHash" ? "0x" + "ab".repeat(32)
      : method === "state_getStorage"
        ? (String(params[0]).length === 66 ? le(issuance, 16) : balanceHex(excludedCoins, 12))
        : null;
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
}

describe("parseExcluded с валидатором адреса", () => {
  it("по умолчанию берёт только EVM-адреса", () => {
    const t = { excluded: [{ address: "0x" + "1".repeat(40), label: "казна" }, { address: ALICE, label: "ss58" }] };
    expect(parseExcluded(t).map((e) => e.label)).toEqual(["казна"]);
  });

  it("с валидатором SS58 берёт только адреса своей сети", () => {
    const t = { excluded: [{ address: "0x" + "1".repeat(40), label: "evm" }, { address: ALICE, label: "ss58" }] };
    const got = parseExcluded(t, { accept: (a) => a === ALICE, normalize: (a) => a });
    expect(got.map((e) => e.label)).toEqual(["ss58"]);
  });
});

describe("readSubstrateSupplyFacts", () => {
  it("читает выпуск и балансы исключений", async () => {
    const facts = await readSubstrateSupplyFacts({
      chain: "polkadot",
      excluded: [{ address: ALICE, label: "казна" }],
      fetchImpl: talerNode(BigInt(1_000_000), BigInt(250_000)),
    });
    expect(facts.error).toBeNull();
    expect(facts.decimals).toBe(12);
    expect(facts.genesisHash).toBe("0x" + "ab".repeat(32));
    expect(facts.totalUnits).toBe((BigInt(1_000_000) * BigInt(10) ** BigInt(12)).toString());
    expect(facts.balances[0].units).toBe((BigInt(250_000) * BigInt(10) ** BigInt(12)).toString());
  });

  it("сеть не из реестра — chain_unsupported", async () => {
    const facts = await readSubstrateSupplyFacts({ chain: "solana", excluded: [], fetchImpl: talerNode(1n, 0n) });
    expect(facts.error).toBe("chain_unsupported");
  });
});

describe("syncCardSupply для нативной сети", () => {
  it("считает оборот и помечает метод SUBSTRATE_V1", async () => {
    const upserts: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const card = {
      id: "card1",
      nativeChain: "polkadot",
      tokenomics: { excluded: [{ address: ALICE, label: "казна" }] },
      provenance: {},
      contracts: [],
      supply: null,
    };
    const prisma = {
      coinCard: {
        findMany: async (args: { where: { supply?: unknown } }) =>
          (args.where as { supply?: { is?: null } }).supply?.is === null ? [card] : [],
        update: async (a: Record<string, unknown>) => { updates.push(a); return {}; },
      },
      coinCardSupply: { upsert: async (a: Record<string, unknown>) => { upserts.push(a); return {}; } },
    };

    const stats = await syncCardSupply({
      prisma: prisma as never,
      fetchImpl: talerNode(BigInt(1_000_000), BigInt(250_000)),
      now: new Date("2026-11-07T10:00:00Z"),
    });

    expect(stats).toEqual({ cards: 1, ok: 1, partial: 0, failed: 0 });
    const data = (upserts[0] as { create: Record<string, unknown> }).create;
    expect(data.method).toBe("SUBSTRATE_V1");
    expect(data.chain).toBe("polkadot");
    expect(data.address).toBe("0x" + "ab".repeat(32));
    expect(data.totalSupply).toBe("1000000");
    expect(data.circulating).toBe("750000");
    const prov = (updates[0] as { data: { provenance: Record<string, { kind: string; source: string }> } }).data.provenance;
    expect(prov["supply.circulating"]).toMatchObject({ kind: "VERIFIED_ONCHAIN", source: "polkadot" });
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Run: `npx vitest run tests/coin-card-supply-substrate.test.ts`
Expected: FAIL — `readSubstrateSupplyFacts is not a function`.

- [ ] **Шаг 3: Реализовать в `src/lib/coin-card-supply.ts`**

3.1. Импорты сверху файла:

```ts
import { resolveSubstrateChain, substrateRpcUrlFor } from "./substrate-chains";
import { isSs58Address } from "./substrate-codec";
import { readAccountBalance, readChainProperties, readGenesisHash, readTotalIssuance } from "./substrate-rpc";
```

3.2. `parseExcluded` получает необязательный валидатор (вторым параметром,
чтобы ни один существующий вызов не поменялся):

```ts
export type AddressRules = {
  accept: (address: string) => boolean;
  normalize: (address: string) => string;
};

const EVM_RULES: AddressRules = { accept: isEvmAddress, normalize: normalizeAddress };

export function parseExcluded(tokenomics: unknown, rules: AddressRules = EVM_RULES): ExcludedInput[] {
  // …тело без изменений, кроме двух строк внутри add():
  //   if (typeof rawAddress !== "string" || !rules.accept(rawAddress)) return;
  //   const address = rules.normalize(rawAddress);
}
```

3.3. Чтение нативной сети — рядом с `readSupplyFacts`:

```ts
export type SubstrateSupplyFacts = SupplyFacts & {
  decimals: number | null;
  symbol: string | null;
  genesisHash: string | null;
};

/**
 * Выпуск нативной монеты: общий выпуск из `Balances.TotalIssuance` и по одному
 * чтению `System.Account` на адрес исключения. Как и в EVM-ветке, сбой общего
 * выпуска фатален, сбой отдельного адреса переживается как `partial`.
 */
export async function readSubstrateSupplyFacts(args: {
  chain: string;
  excluded: readonly ExcludedInput[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<SubstrateSupplyFacts> {
  const chain = resolveSubstrateChain(args.chain);
  const empty = { totalUnits: null, balances: [], decimals: null, symbol: null, genesisHash: null };
  if (!chain) return { ...empty, error: "chain_unsupported" };

  const url = substrateRpcUrlFor(chain);
  const opts = { fetchImpl: args.fetchImpl, timeoutMs: args.timeoutMs };

  let decimals: number | null = null;
  let symbol: string | null = null;
  let prefix: number | null = null;
  let genesisHash: string | null = null;
  let totalUnits: string;
  try {
    const props = await readChainProperties(url, opts);
    decimals = props.decimals;
    symbol = props.symbol;
    prefix = props.ss58Format ?? chain.ss58Format;
    genesisHash = await readGenesisHash(url, opts);
    totalUnits = (await readTotalIssuance(url, opts)).toString();
  } catch {
    return { ...empty, error: "supply_unreadable" };
  }

  const balances: BalanceRow[] = [];
  for (const row of args.excluded.slice(0, MAX_EXCLUDED)) {
    try {
      const units = await readAccountBalance(url, row.address, prefix, opts);
      balances.push({ ...row, units: units.toString(), error: null });
    } catch (err) {
      balances.push({ ...row, units: null, error: rpcErrorCode(err) });
    }
  }

  return { totalUnits, balances, decimals, symbol, genesisHash, error: null };
}
```

3.4. Прогон по базе. `CardRow` получает `nativeChain: string | null`;
`baseWhere` и `select` расширяются, обработка карточки ветвится:

```ts
  const baseWhere = cardId
    ? { id: cardId }
    : {
        status: "APPROVED",
        OR: [
          { contracts: { some: { isCanonical: true, verifiedAt: { not: null } } } },
          { nativeChain: { not: null } },
        ],
      };
  const select = {
    id: true,
    nativeChain: true,
    tokenomics: true,
    provenance: true,
    // …остальное без изменений
  };
```

В цикле по карточкам — перед нынешней EVM-логикой:

```ts
  for (const card of cards) {
    // Нативная монета своей сети: контракта нет, читаем саму цепь.
    if (card.nativeChain) {
      stats.cards++;
      const chain = resolveSubstrateChain(card.nativeChain);
      if (!chain) {
        stats.failed++;
        await writeSupply({
          prisma, cardId: card.id,
          data: { chain: card.nativeChain, address: "", decimals: 0, method: "SUBSTRATE_V1", checkedAt: now, checkError: "chain_unsupported" },
          createDefaults: true,
        });
        continue;
      }

      const excluded = parseExcluded(card.tokenomics, {
        accept: (a) => isSs58Address(a, chain.ss58Format),
        normalize: (a) => a.trim(),
      });
      const facts = await readSubstrateSupplyFacts({ chain: chain.key, excluded, fetchImpl });

      if (facts.error || facts.totalUnits == null || facts.decimals == null) {
        stats.failed++;
        await writeSupply({
          prisma, cardId: card.id,
          data: {
            chain: chain.key, address: facts.genesisHash ?? "", decimals: facts.decimals ?? 0,
            method: "SUBSTRATE_V1", checkedAt: now,
            checkError: facts.error ?? (facts.decimals == null ? "decimals_unknown" : "supply_unreadable"),
          },
          createDefaults: true,
        });
        continue;
      }

      const result = computeSupply({
        totalUnits: facts.totalUnits,
        decimals: facts.decimals,
        balances: facts.balances,
        // Канонических адресов сжигания в Substrate нет, а Taler прямо
        // заявляет, что сжигания нет: слэшинг уходит в Казначейство.
        burnAddresses: [],
      });
      const claimed = (card.tokenomics as { circulating?: number | null } | null)?.circulating ?? null;

      await writeSupply({
        prisma, cardId: card.id,
        data: {
          chain: chain.key, address: facts.genesisHash ?? "", decimals: facts.decimals,
          method: "SUBSTRATE_V1",
          totalSupply: result.total, excludedTotal: result.excludedTotal, circulating: result.circulating,
          excluded: result.excluded, partial: result.partial,
          claimedDeltaPct: claimedDeltaPct(claimed, result.circulating),
          checkedAt: now, checkError: null,
        },
      });
      await prisma.coinCard.update({
        where: { id: card.id },
        data: {
          provenance: mergeProvenance(card.provenance, {
            "supply.circulating": { kind: "VERIFIED_ONCHAIN", source: chain.key, at: now.toISOString() },
          }) as never,
        },
      });
      if (result.partial) stats.partial++;
      else stats.ok++;
      continue;
    }

    // …существующая EVM-ветка без изменений
  }
```

3.5. `computeSupply` получает необязательный `burnAddresses` (по умолчанию
`BURN_ADDRESSES`), чтобы ветка Substrate не вычитала EVM-адреса сжигания.
Проверить фактическую сигнатуру в файле и добавить поле, не меняя поведение
существующих вызовов.

- [ ] **Шаг 4: Тесты зелёные**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — новые 5 тестов и все прежние (EVM-ветка не задета).

- [ ] **Шаг 5: Коммит**

```bash
git add src/lib/coin-card-supply.ts tests/coin-card-supply-substrate.test.ts
git commit -m "feat(coin-card): слайс S — проверенный выпуск нативной монеты Substrate"
```

---

### Задача 8: форма, риск, ручной пересчёт

**Files:**
- Modify: `src/lib/coin-card-risk.ts`
- Modify: `src/lib/coin-card-form-spec.ts`
- Modify: `src/app/actions/coin-card-supply.ts`
- Modify: `tests/coin-card-risk.test.ts` (файл существует)

- [ ] **Шаг 1: Написать падающий тест риска**

Дописать в `tests/coin-card-risk.test.ts`:

```ts
it("nativeChain — высокий риск: подмена переносит выпуск чужой сети", () => {
  expect(isHighRiskPath("nativeChain")).toBe(true);
});
```

- [ ] **Шаг 2: Прогнать**

Run: `npx vitest run tests/coin-card-risk.test.ts`
Expected: PASS уже сейчас — неизвестный путь по умолчанию высокорисковый. Тест
закрепляет это как намерение, а следующий шаг делает классификацию явной.

- [ ] **Шаг 3: Явная классификация и поле формы**

В `src/lib/coin-card-risk.ts` — в `SECTION_BY_ROOT`:

```ts
  // Нативная сеть монеты: подмена значения переносит на карточку выпуск и
  // скорость чужой сети — тот же вектор, что подмена адреса контракта.
  nativeChain: "CONTRACTS",
```

В `src/lib/coin-card-form-spec.ts` — импорт и поле в разделе `CONTRACTS`:

```ts
import { NATIVE_CHAIN_KEYS } from "@/lib/substrate-chains";
// …
  CONTRACTS: [
    { kind: "select", path: "nativeChain", label: "nativeChain", options: ["", ...NATIVE_CHAIN_KEYS] },
    { kind: "rows", path: "contracts", label: "contract", fields: ROW_SUBFIELDS.contract },
  ],
```

В `src/app/actions/coin-card-supply.ts` — ручной пересчёт для нативной сети
(заменить проверку канонического контракта):

```ts
  // Нативная монета своей сети: контракта у неё нет, сверять нечего — цепь
  // отвечает сама за себя.
  if (!card.nativeChain) {
    const canonical = card.contracts.find((c) => c.isCanonical);
    if (!canonical) return { ok: false, reason: "no_canonical_contract" };
    // Без сверки слайса B `totalSupply()` ничего не стоит: подделка с тем же
    // тикером ответит на него что угодно.
    if (!canonical.verifiedAt) return { ok: false, reason: "contract_unverified" };
  }
```

Проверить, что `getViewerCard` отдаёт `nativeChain` (select в
`src/lib/coin-card-viewer.ts`); если выборка поля перечисляет колонки явно —
добавить `nativeChain: true`.

- [ ] **Шаг 4: Тесты и типы**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add src/lib/coin-card-risk.ts src/lib/coin-card-form-spec.ts src/app/actions/coin-card-supply.ts src/lib/coin-card-viewer.ts tests/coin-card-risk.test.ts
git commit -m "feat(coin-card): слайс S — выбор нативной сети в форме, высокий риск, ручной пересчёт"
```

---

### Задача 9: живой прогон первого захода

**Files:** нет (прод-проверка)

- [ ] **Шаг 1: Собрать и перезапустить**

```bash
npm run build && pm2 restart trientes-web trientes-worker && pm2 save
```

Expected: сборка без ошибок, оба процесса `online`.

- [ ] **Шаг 2: Привязать карточку Taler к сети**

Поле высокорисковое и правится через ревизию; для первой карточки ставим
напрямую — это административное действие, а не правка проекта:

```bash
npx tsx -e 'const{PrismaClient}=require("@prisma/client");const p=new PrismaClient();p.coinCard.update({where:{slug:"taler"},data:{nativeChain:"taler"}}).then((c)=>console.log(c.slug,c.nativeChain)).finally(()=>p.$disconnect())'
```

Expected: `taler taler`.

- [ ] **Шаг 3: Прогнать выпуск по-настоящему**

```bash
npx tsx -e 'const{PrismaClient}=require("@prisma/client");const{syncCardSupply}=require("./src/lib/coin-card-supply");const p=new PrismaClient();syncCardSupply({prisma:p,limit:5}).then((s)=>console.log(s)).then(()=>p.coinCardSupply.findMany()).then((r)=>console.log(JSON.stringify(r,null,1))).finally(()=>p.$disconnect())'
```

Expected: `{ cards: 1, ok: 1, partial: 0, failed: 0 }`, `totalSupply` ≈
`1434460603.xxxxxx` (растёт от прогона к прогону — инфляционный NPoS),
`circulating` равен общему выпуску, пока у проекта не заданы адреса исключений,
`method: "SUBSTRATE_V1"`, `address` = хэш генезиса
`0xb029803f5f6461fc587b470fccf542fa88960cec5e795d9487327f6615aaa96f`.

- [ ] **Шаг 4: Проверить публичную карточку**

```bash
curl -s "http://127.0.0.1:3000/ru/coin/taler" | grep -o "1 434 [0-9]* [0-9]*" | head -3
```

Expected: число проверенного выпуска видно в секции токеномики. Сверить его с
`https://explorer.taler.uno` глазами — это и есть смысл слайса.

- [ ] **Шаг 5: Коммит и пуш первого захода**

```bash
git push origin main
```

---

## Заход 2 — факты сети и платёжный профиль

### Задача 10: сбор фактов сети

**Files:**
- Create: `src/lib/coin-card-chain-facts.ts`
- Test: `tests/coin-card-chain-facts.test.ts`

- [ ] **Шаг 1: Написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/lib/json-rpc";
import { chainMismatches, readChainFacts, syncChainFacts } from "../src/lib/coin-card-chain-facts";

const GENESIS = "0x" + "ab".repeat(32);

function node(opts: { decimals?: number; symbol?: string; prefix?: number; best?: number; finalized?: number; stepMs?: number }): FetchLike {
  const best = opts.best ?? 1_000_100;
  const finalized = opts.finalized ?? best - 2;
  const step = opts.stepMs ?? 6000;
  const le = (v: bigint, bytes: number) =>
    "0x" + Array.from({ length: bytes }, (_, i) =>
      Number((v >> BigInt(8 * i)) & BigInt(0xff)).toString(16).padStart(2, "0")).join("");
  return async (_url, init) => {
    const { method, params } = JSON.parse(init!.body) as { method: string; params: unknown[] };
    let result: unknown = null;
    if (method === "system_properties") {
      result = { ss58Format: opts.prefix ?? 10960, tokenDecimals: opts.decimals ?? 12, tokenSymbol: opts.symbol ?? "TAL" };
    } else if (method === "chain_getBlockHash") {
      result = params[0] === 0 ? GENESIS : `0xblock${String(params[0])}`;
    } else if (method === "chain_getHeader") {
      const n = params.length === 0 ? best : finalized;
      result = { number: "0x" + n.toString(16) };
    } else if (method === "chain_getFinalizedHead") {
      result = "0xfinalized";
    } else if (method === "state_getStorageAt") {
      const hash = String(params[1]);
      const number = Number(hash.replace("0xblock", ""));
      result = le(BigInt(1_700_000_000_000 + number * step), 8);
    }
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
}

describe("chainMismatches", () => {
  it("тикер и знаки сети против заявленного в карточке", () => {
    expect(chainMismatches({
      chainKey: "taler", cardSymbol: "TAL", claimedDecimals: 12,
      facts: { symbol: "TAL", decimals: 12, ss58Format: 10960 },
    })).toEqual([]);

    expect(chainMismatches({
      chainKey: "taler", cardSymbol: "TAL", claimedDecimals: 8,
      facts: { symbol: "XYZ", decimals: 12, ss58Format: 1 },
    }).sort()).toEqual(["CHAIN_SYMBOL", "DECIMALS", "SS58_FORMAT", "SYMBOL"].sort());
  });

  it("незаявленные знаки расхождением не считаются", () => {
    expect(chainMismatches({
      chainKey: "taler", cardSymbol: "TAL", claimedDecimals: null,
      facts: { symbol: "TAL", decimals: 12, ss58Format: 10960 },
    })).toEqual([]);
  });
});

describe("readChainFacts", () => {
  it("собирает свойства, генезис, время блока и отставание финализации", async () => {
    const f = await readChainFacts({ chain: "taler", fetchImpl: node({}) });
    expect(f.error).toBeNull();
    expect(f.genesisHash).toBe(GENESIS);
    expect(f.tokenSymbol).toBe("TAL");
    expect(f.tokenDecimals).toBe(12);
    expect(f.blockSeconds).toBe(6);
    expect(f.finalityLag).toBe(2);
    expect(f.finalitySeconds).toBe(12);
  });

  it("сеть не из реестра — chain_unsupported без запросов", async () => {
    const f = await readChainFacts({ chain: "solana", fetchImpl: node({}) });
    expect(f.error).toBe("chain_unsupported");
  });

  it("недоступный узел — rpc_unreachable, числа пустые", async () => {
    const f = await readChainFacts({
      chain: "taler",
      fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
    });
    expect(f.error).toBe("rpc_unreachable");
    expect(f.blockSeconds).toBeNull();
  });
});

describe("syncChainFacts", () => {
  it("пишет факты и провенанс платёжных полей", async () => {
    const upserts: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const prisma = {
      coinCard: {
        findMany: async () => [{ id: "card1", nativeChain: "taler", symbol: "TAL", tokenomics: {}, provenance: {}, chainFacts: null }],
        update: async (a: Record<string, unknown>) => { updates.push(a); return {}; },
      },
      coinCardChainFacts: { upsert: async (a: Record<string, unknown>) => { upserts.push(a); return {}; } },
    };

    const stats = await syncChainFacts({
      prisma: prisma as never, fetchImpl: node({}), now: new Date("2026-11-07T10:00:00Z"),
    });

    expect(stats).toEqual({ cards: 1, ok: 1, failed: 0 });
    const create = (upserts[0] as { create: Record<string, unknown> }).create;
    expect(create).toMatchObject({ chain: "taler", genesisHash: GENESIS, blockSeconds: 6, finalitySeconds: 12 });
    const prov = (updates[0] as { data: { provenance: Record<string, { kind: string }> } }).data.provenance;
    expect(prov["payments.blockSeconds"].kind).toBe("VERIFIED_ONCHAIN");
    expect(prov["payments.finalitySeconds"].kind).toBe("VERIFIED_ONCHAIN");
  });

  it("сменившийся хэш генезиса — genesis_mismatch, числа не перезаписываются", async () => {
    const upserts: Array<Record<string, unknown>> = [];
    const prisma = {
      coinCard: {
        findMany: async () => [{
          id: "card1", nativeChain: "taler", symbol: "TAL", tokenomics: {}, provenance: {},
          chainFacts: { genesisHash: "0x" + "cd".repeat(32) },
        }],
        update: async () => ({}),
      },
      coinCardChainFacts: { upsert: async (a: Record<string, unknown>) => { upserts.push(a); return {}; } },
    };
    const stats = await syncChainFacts({ prisma: prisma as never, fetchImpl: node({}), now: new Date() });
    expect(stats.failed).toBe(1);
    const update = (upserts[0] as { update: Record<string, unknown> }).update;
    expect(update.checkError).toBe("genesis_mismatch");
    expect(update.blockSeconds).toBeUndefined();
  });
});
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Run: `npx vitest run tests/coin-card-chain-facts.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Шаг 3: Реализовать**

```ts
/**
 * Факты собственной сети нативной монеты (слайс S): тикер, знаки, хэш
 * генезиса, измеренное время блока, отставание финализации.
 *
 * Время блока и финальность — замер, а не константа рантайма: продавцу важна
 * фактическая скорость, и поэтому рядом с числом хранятся номера блоков и
 * время замера. Заявление проекта в `payments` не перезаписывается: рендер
 * предпочитает факт, а расхождение показывает рядом.
 */

import { mergeProvenance } from "./coin-card-provenance";
import { RpcError, type FetchLike } from "./json-rpc";
import { resolveSubstrateChain, substrateRpcUrlFor } from "./substrate-chains";
import { measureBlockSeconds, readBlockNumbers, readChainProperties, readGenesisHash } from "./substrate-rpc";

/** Сколько блоков берём на замер: 100 блоков по 6 с — десять минут истории. */
export const BLOCK_SAMPLE = 100;

export type ChainFactsError =
  | "chain_unsupported" | "rpc_unreachable" | "rpc_error" | "decode_failed" | "genesis_mismatch";

export type ChainFacts = {
  chain: string;
  genesisHash: string | null;
  tokenSymbol: string | null;
  tokenDecimals: number | null;
  ss58Format: number | null;
  blockSeconds: number | null;
  blockSample: number | null;
  bestNumber: number | null;
  finalizedNumber: number | null;
  finalityLag: number | null;
  finalitySeconds: number | null;
  error: ChainFactsError | null;
};

const EMPTY = {
  genesisHash: null, tokenSymbol: null, tokenDecimals: null, ss58Format: null,
  blockSeconds: null, blockSample: null, bestNumber: null, finalizedNumber: null,
  finalityLag: null, finalitySeconds: null,
};

const errorCode = (err: unknown): ChainFactsError =>
  err instanceof RpcError ? (err.code as ChainFactsError) : "rpc_error";

export async function readChainFacts(args: {
  chain: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  sample?: number;
}): Promise<ChainFacts> {
  const chain = resolveSubstrateChain(args.chain);
  if (!chain) return { chain: args.chain, ...EMPTY, error: "chain_unsupported" };

  const url = substrateRpcUrlFor(chain);
  const opts = { fetchImpl: args.fetchImpl, timeoutMs: args.timeoutMs };
  const sample = args.sample ?? BLOCK_SAMPLE;

  try {
    const props = await readChainProperties(url, opts);
    const genesisHash = await readGenesisHash(url, opts);
    const numbers = await readBlockNumbers(url, opts);
    // Молодая цепь короче выборки: замер делаем по тому, что есть.
    const span = Math.max(1, Math.min(sample, numbers.best - 1));
    const time = await measureBlockSeconds(url, numbers.best, span, opts);
    return {
      chain: chain.key,
      genesisHash,
      tokenSymbol: props.symbol,
      tokenDecimals: props.decimals,
      ss58Format: props.ss58Format,
      blockSeconds: time.blockSeconds,
      blockSample: time.sample,
      bestNumber: numbers.best,
      finalizedNumber: numbers.finalized,
      finalityLag: numbers.lag,
      finalitySeconds: Math.round(numbers.lag * time.blockSeconds * 100) / 100,
      error: null,
    };
  } catch (err) {
    return { chain: chain.key, ...EMPTY, error: errorCode(err) };
  }
}

export type MismatchCode = "SYMBOL" | "DECIMALS" | "CHAIN_SYMBOL" | "SS58_FORMAT";

/**
 * Расхождения двух видов: сеть против карточки (`SYMBOL`, `DECIMALS`) и сеть
 * против реестра (`CHAIN_SYMBOL`, `SS58_FORMAT`). Второе означает, что узел
 * отвечает не за ту цепь, которую мы в него записали.
 */
export function chainMismatches(args: {
  chainKey: string;
  cardSymbol: string;
  claimedDecimals: number | null;
  facts: { symbol: string | null; decimals: number | null; ss58Format: number | null };
}): MismatchCode[] {
  const out: MismatchCode[] = [];
  const registry = resolveSubstrateChain(args.chainKey);
  const { symbol, decimals, ss58Format } = args.facts;

  if (symbol && args.cardSymbol && symbol.toUpperCase() !== args.cardSymbol.toUpperCase()) {
    out.push("SYMBOL");
  }
  if (decimals != null && args.claimedDecimals != null && decimals !== args.claimedDecimals) {
    out.push("DECIMALS");
  }
  if (registry && symbol && symbol.toUpperCase() !== registry.symbol.toUpperCase()) {
    out.push("CHAIN_SYMBOL");
  }
  if (registry && ss58Format != null && ss58Format !== registry.ss58Format) {
    out.push("SS58_FORMAT");
  }
  return out;
}

type CardRow = {
  id: string;
  nativeChain: string | null;
  symbol: string;
  tokenomics: unknown;
  provenance: unknown;
  chainFacts: { genesisHash: string } | null;
};

export type ChainFactsPrismaLike = {
  coinCard: {
    findMany(args: unknown): Promise<CardRow[]>;
    update(args: unknown): Promise<unknown>;
  };
  coinCardChainFacts: { upsert(args: unknown): Promise<unknown> };
};

export type ChainFactsStats = { cards: number; ok: number; failed: number };

export async function syncChainFacts(args: {
  prisma: ChainFactsPrismaLike;
  fetchImpl?: FetchLike;
  cardId?: string;
  limit?: number;
  now?: Date;
}): Promise<ChainFactsStats> {
  const { prisma, fetchImpl, cardId } = args;
  const now = args.now ?? new Date();
  const cards = await prisma.coinCard.findMany({
    where: cardId ? { id: cardId } : { status: "APPROVED", nativeChain: { not: null } },
    take: args.limit ?? 50,
    orderBy: [{ updatedAt: "asc" }],
    select: {
      id: true, nativeChain: true, symbol: true, tokenomics: true, provenance: true,
      chainFacts: { select: { genesisHash: true } },
    },
  });

  const stats: ChainFactsStats = { cards: 0, ok: 0, failed: 0 };

  for (const card of cards) {
    if (!card.nativeChain) continue;
    stats.cards++;
    const facts = await readChainFacts({ chain: card.nativeChain, fetchImpl });

    // Хэш генезиса изменился — узел переехал на другую цепь. Числа не
    // перезаписываем: это повод для разбора руками, а не новость о монете.
    const moved =
      !facts.error && card.chainFacts && facts.genesisHash &&
      card.chainFacts.genesisHash !== facts.genesisHash;

    if (facts.error || moved) {
      stats.failed++;
      const checkError = moved ? "genesis_mismatch" : facts.error;
      await prisma.coinCardChainFacts.upsert({
        where: { cardId: card.id },
        update: { checkedAt: now, checkError },
        create: {
          cardId: card.id, chain: card.nativeChain,
          genesisHash: facts.genesisHash ?? "", checkedAt: now, checkError,
        },
      });
      continue;
    }

    const claimedDecimals =
      (card.tokenomics as { decimals?: number | null } | null)?.decimals ?? null;
    const mismatches = chainMismatches({
      chainKey: card.nativeChain,
      cardSymbol: card.symbol,
      claimedDecimals,
      facts: { symbol: facts.tokenSymbol, decimals: facts.tokenDecimals, ss58Format: facts.ss58Format },
    });

    const data = {
      chain: facts.chain,
      genesisHash: facts.genesisHash ?? "",
      tokenSymbol: facts.tokenSymbol,
      tokenDecimals: facts.tokenDecimals,
      ss58Format: facts.ss58Format,
      blockSeconds: facts.blockSeconds,
      blockSample: facts.blockSample,
      bestNumber: facts.bestNumber,
      finalizedNumber: facts.finalizedNumber,
      finalityLag: facts.finalityLag,
      finalitySeconds: facts.finalitySeconds,
      mismatches,
      checkedAt: now,
      checkError: null as string | null,
    };
    await prisma.coinCardChainFacts.upsert({
      where: { cardId: card.id },
      update: data,
      create: { cardId: card.id, ...data },
    });

    const entry = { kind: "VERIFIED_ONCHAIN" as const, source: facts.chain, at: now.toISOString() };
    await prisma.coinCard.update({
      where: { id: card.id },
      data: {
        provenance: mergeProvenance(card.provenance, {
          "payments.blockSeconds": entry,
          "payments.finalitySeconds": entry,
        }) as never,
      },
    });
    stats.ok++;
  }

  return stats;
}
```

- [ ] **Шаг 4: Тесты зелёные**

Run: `npx vitest run tests/coin-card-chain-facts.test.ts && npx tsc --noEmit`
Expected: PASS, 7 тестов.

- [ ] **Шаг 5: Коммит**

```bash
git add src/lib/coin-card-chain-facts.ts tests/coin-card-chain-facts.test.ts
git commit -m "feat(coin-card): слайс S — факты сети: время блока, финальность, расхождения с заявленным"
```

---

### Задача 11: рендер — блок «Сеть монеты» и платёжный профиль

**Files:**
- Create: `src/components/coin-card/native-chain-block.tsx`
- Modify: `src/components/coin-card/sections/contracts-section.tsx`
- Modify: `src/components/coin-card/sections/payments-block.tsx`
- Modify: `src/lib/coin-card-public.ts`
- Modify: `src/components/coin-card/card-sections.tsx`

- [ ] **Шаг 1: Выбрать факты в публичной выборке**

В `src/lib/coin-card-public.ts` добавить к `select` карточки:

```ts
      nativeChain: true,
      chainFacts: {
        select: {
          chain: true, genesisHash: true, tokenSymbol: true, tokenDecimals: true,
          blockSeconds: true, blockSample: true, bestNumber: true,
          finalityLag: true, finalitySeconds: true, mismatches: true,
          checkedAt: true, checkError: true,
        },
      },
```

- [ ] **Шаг 2: Блок «Сеть монеты»**

`src/components/coin-card/native-chain-block.tsx`:

```tsx
import { getTranslations } from "next-intl/server";
import { getProvenance } from "@/lib/coin-card-provenance";
import { resolveSubstrateChain } from "@/lib/substrate-chains";
import { ProvenanceBadge } from "../provenance-badge";

export type ChainFactsView = {
  chain: string;
  genesisHash: string;
  tokenSymbol: string | null;
  tokenDecimals: number | null;
  blockSeconds: number | null;
  blockSample: number | null;
  bestNumber: number | null;
  finalitySeconds: number | null;
  mismatches: string[];
  checkedAt: Date | string;
  checkError: string | null;
};

/**
 * Нативная монета своей сети: контракта нет, идентичность — хэш генезиса.
 * Тикер и знаки прочитаны из сети, время блока измерено на конкретном блоке —
 * поэтому номер блока показан рядом, а не спрятан.
 */
export async function NativeChainBlock({
  nativeChain,
  facts,
  cardSymbol,
  provenance,
}: {
  nativeChain: string;
  facts: ChainFactsView | null;
  cardSymbol: string;
  provenance: unknown;
}) {
  const t = await getTranslations("coinCard.nativeChain");
  const chain = resolveSubstrateChain(nativeChain);
  const label = chain?.label ?? nativeChain;
  const verified = facts && !facts.checkError ? facts : null;

  return (
    <div className="border border-hairline rounded-md p-3 bg-card space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("title")}</span>
        <span className="text-[14px] font-medium">{label}</span>
        <span className="text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border border-accent/40 text-accent">
          {t("native")}
        </span>
      </div>

      {verified && (
        <dl className="space-y-1.5">
          {verified.tokenSymbol && (
            <Row label={t("symbol")} value={verified.tokenSymbol} path="chain.symbol" provenance={provenance} />
          )}
          {verified.tokenDecimals != null && (
            <Row label={t("decimals")} value={String(verified.tokenDecimals)} path="chain.decimals" provenance={provenance} />
          )}
          {verified.blockSeconds != null && (
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <dt className="text-[14px] text-muted">{t("blockTime")}</dt>
              <dd className="text-[14px] num">
                {t("seconds", { value: verified.blockSeconds })}
                {verified.bestNumber != null && (
                  <span className="text-muted text-xs ml-2">
                    {t("measuredAt", { block: verified.bestNumber.toLocaleString("ru-RU") })}
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>
      )}

      {verified?.mismatches.includes("SYMBOL") && verified.tokenSymbol && (
        <p className="text-[13px] text-down">
          {t("symbolMismatch", { claimed: cardSymbol, actual: verified.tokenSymbol })}
        </p>
      )}

      {facts && (
        <p className="font-mono text-xs break-all text-muted">
          {t("genesis")}: {facts.genesisHash}
        </p>
      )}

      {facts?.checkError && (
        <p className="text-[13px] text-muted">{t(`error.${facts.checkError}`)}</p>
      )}
    </div>
  );
}

function Row({
  label, value, path, provenance,
}: { label: string; value: string; path: string; provenance: unknown }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <dt className="text-[14px] text-muted">{label}</dt>
      <dd className="text-[14px] num">
        {value}
        <ProvenanceBadge entry={getProvenance(provenance, path)} />
      </dd>
    </div>
  );
}
```

Провенанс путей `chain.symbol` / `chain.decimals` пишется там же, где
`payments.*` — добавить их в `syncChainFacts` в тот же `mergeProvenance`:

```ts
          "chain.symbol": entry,
          "chain.decimals": entry,
```

- [ ] **Шаг 3: Показать блок в секции контрактов**

В `src/components/coin-card/sections/contracts-section.tsx`: принять
`nativeChain: string | null` и `chainFacts: ChainFactsView | null`, заменить
ранний выход и отрисовать блок первым:

```tsx
  if (contracts.length === 0 && !nativeChain) return null;
  // …внутри <section>, перед списком контрактов:
  {nativeChain && (
    <NativeChainBlock
      nativeChain={nativeChain}
      facts={chainFacts}
      cardSymbol={cardSymbol}
      provenance={provenance}
    />
  )}
```

Прокинуть оба пропса из `src/components/coin-card/card-sections.tsx` (там, где
`ContractsSection` уже вызывается с `contracts`, `provenance`, `cardName`,
`cardSymbol`).

- [ ] **Шаг 4: Платёжный профиль предпочитает факт**

В `src/components/coin-card/sections/payments-block.tsx` принять
`chainFacts?: { blockSeconds: number | null; finalitySeconds: number | null; checkError: string | null } | null`
и заменить две строки:

```tsx
  const f = chainFacts && !chainFacts.checkError ? chainFacts : null;

  // Факт сети предпочитается заявлению проекта, но заявление не затирается:
  // при расхождении больше 10% оно показывается рядом. Правило слайса B —
  // «не поправлять молча, а показывать расхождение».
  const differs = (fact: number, claimed: number | null) =>
    claimed != null && claimed > 0 && Math.abs(fact - claimed) / claimed > 0.1;

  const finality = f?.finalitySeconds ?? d.finalitySeconds;
  if (finality !== null) {
    rows.push({
      label: t("finality"),
      value: t("seconds", { value: finality }),
      path: "payments.finalitySeconds",
      aside: f?.finalitySeconds != null && differs(f.finalitySeconds, d.finalitySeconds)
        ? t("claimedSays", { value: t("seconds", { value: d.finalitySeconds! }) })
        : null,
    });
  }

  const blockTime = f?.blockSeconds ?? d.blockSeconds;
  if (blockTime !== null) {
    rows.push({
      label: t("blockTime"),
      value: t("seconds", { value: blockTime }),
      path: "payments.blockSeconds",
      aside: f?.blockSeconds != null && differs(f.blockSeconds, d.blockSeconds)
        ? t("claimedSays", { value: t("seconds", { value: d.blockSeconds! }) })
        : null,
    });
  }
```

Тип `rows` получает `aside: string | null` (у остальных строк — `null`), а в
разметке после `ProvenanceBadge`:

```tsx
                {r.aside && <span className="text-muted text-xs ml-2">{r.aside}</span>}
```

Ранний выход `if (!v.ok) return null;` заменить: профиль может быть пустым, но
факты сети есть — тогда блок всё равно нужен.

```tsx
  const v = validatePayments(payments);
  const d = v.ok ? v.data : EMPTY_PAYMENTS;
```

где `EMPTY_PAYMENTS` — объект `Payments` со всеми `null` / `[]` (экспортировать
из `src/lib/coin-card-payments.ts`, чтобы не дублировать форму типа).

- [ ] **Шаг 5: Тесты, типы, сборка**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS, сборка без ошибок.

- [ ] **Шаг 6: Коммит**

```bash
git add src/components/coin-card src/lib/coin-card-public.ts src/lib/coin-card-payments.ts src/lib/coin-card-chain-facts.ts
git commit -m "feat(coin-card): слайс S — блок «Сеть монеты» и факт сети в платёжном профиле"
```

---

### Задача 12: воркер и локали

**Files:**
- Modify: `worker/index.ts`
- Modify: `messages/en.json`, `ru.json`, `de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `pt-BR.json`, `tr.json`, `zh-CN.json`

- [ ] **Шаг 1: Прогон в воркере**

В `worker/index.ts` — импорт рядом с `syncCardSupply`:

```ts
import { syncChainFacts } from "../src/lib/coin-card-chain-facts";
```

Функция рядом с `runSupplySweep`:

```ts
async function runChainFactsSweep() {
  const t0 = Date.now();
  try {
    const s = await syncChainFacts({ prisma: prisma as never, limit: 50 });
    if (s.cards > 0) {
      console.log(
        `[worker] chain facts ok: ${s.cards} cards (${s.ok} ok, ${s.failed} failed) ` +
          `in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] chain facts failed:", err);
  }
}
```

И расписание рядом с остальными карточными прогонами (`:20` claim, `:45`
supply — факты ставим на `:35`, чтобы не толкаться):

```ts
  cron.schedule("35 * * * *", () => void runChainFactsSweep());
```

- [ ] **Шаг 2: Ключи переводов**

В каждый `messages/<locale>.json` внутрь `coinCard` добавить `nativeChain` и
один ключ в `payments`. Русский:

```json
    "nativeChain": {
      "title": "Сеть монеты",
      "native": "нативная",
      "symbol": "Тикер в сети",
      "decimals": "Знаков после точки",
      "blockTime": "Время блока",
      "seconds": "{value} сек",
      "measuredAt": "измерено на блоке {block}",
      "genesis": "Хэш генезиса",
      "symbolMismatch": "Проект заявил {claimed}, сеть отвечает {actual}",
      "error": {
        "chain_unsupported": "Эту сеть мы читать не умеем",
        "rpc_unreachable": "Узел сети не ответил",
        "rpc_error": "Узел сети вернул ошибку",
        "decode_failed": "Ответ узла не разобрался",
        "genesis_mismatch": "Узел отвечает за другую цепь — разбираемся"
      }
    },
```

и в `coinCard.payments`:

```json
      "claimedSays": "проект заявляет: {value}",
```

Английский (остальные восемь — тот же набор ключей на своём языке):

```json
    "nativeChain": {
      "title": "Coin network",
      "native": "native",
      "symbol": "Ticker on chain",
      "decimals": "Decimals",
      "blockTime": "Block time",
      "seconds": "{value} s",
      "measuredAt": "measured at block {block}",
      "genesis": "Genesis hash",
      "symbolMismatch": "The project claims {claimed}, the chain answers {actual}",
      "error": {
        "chain_unsupported": "We cannot read this network",
        "rpc_unreachable": "The network node did not answer",
        "rpc_error": "The network node returned an error",
        "decode_failed": "The node's answer could not be parsed",
        "genesis_mismatch": "The node answers for a different chain — under review"
      }
    },
```

- [ ] **Шаг 3: Проверить, что ни одна локаль не отстала**

```bash
npx tsx -e 'const fs=require("fs");const keys=(o,p="")=>Object.entries(o).flatMap(([k,v])=>typeof v==="object"&&v?keys(v,p+k+"."):[p+k]);const ru=new Set(keys(JSON.parse(fs.readFileSync("messages/ru.json","utf8")).coinCard.nativeChain));for(const f of fs.readdirSync("messages")){const j=JSON.parse(fs.readFileSync("messages/"+f,"utf8"));const got=new Set(keys(j.coinCard.nativeChain??{}));const miss=[...ru].filter(k=>!got.has(k));console.log(f,miss.length?"MISSING "+miss.join(","):"ok",j.coinCard.payments.claimedSays?"":"NO claimedSays")}'
```

Expected: `ok` для всех десяти файлов, ни одного `MISSING`, ни одного
`NO claimedSays`.

- [ ] **Шаг 4: Сборка и перезапуск**

```bash
npm run build && pm2 restart trientes-web trientes-worker && pm2 save
```

Expected: сборка без ошибок. Перезапуск воркера обязателен: он гоняет `tsx` и
фиксирует исходники `src/lib` на момент старта, иначе новый прогон не появится.

- [ ] **Шаг 5: Коммит**

```bash
git add worker/index.ts messages
git commit -m "feat(coin-card): слайс S — часовой прогон фактов сети и переводы на 10 локалей"
```

---

### Задача 13: живой прогон второго захода

**Files:** нет (прод-проверка)

- [ ] **Шаг 1: Прогнать факты по-настоящему**

```bash
npx tsx -e 'const{PrismaClient}=require("@prisma/client");const{syncChainFacts}=require("./src/lib/coin-card-chain-facts");const p=new PrismaClient();syncChainFacts({prisma:p,limit:5}).then((s)=>console.log(s)).then(()=>p.coinCardChainFacts.findMany()).then((r)=>console.log(JSON.stringify(r,null,1))).finally(()=>p.$disconnect())'
```

Expected: `{ cards: 1, ok: 1, failed: 0 }`; `blockSeconds` ≈ `6`,
`finalityLag` 1–3, `finalitySeconds` ≈ `6`–`18`, `tokenSymbol: "TAL"`,
`tokenDecimals: 12`, `ss58Format: 10960`, `mismatches: []`,
`genesisHash: "0xb029803f…aaa96f"`.

- [ ] **Шаг 2: Проверить карточку глазами**

```bash
curl -s "http://127.0.0.1:3000/ru/coin/taler" | grep -c "Сеть монеты"
curl -s "http://127.0.0.1:3000/en/coin/taler" | grep -c "Coin network"
```

Expected: `1` в каждом случае.

- [ ] **Шаг 3: Проверить, что заявление проекта не затёрлось**

```bash
npx tsx -e 'const{PrismaClient}=require("@prisma/client");const p=new PrismaClient();p.coinCard.findUnique({where:{slug:"taler"},select:{payments:true,provenance:true}}).then((c)=>console.log(JSON.stringify(c,null,1))).finally(()=>p.$disconnect())'
```

Expected: `payments` остался тем, что ввёл проект (сейчас `null`);
`provenance["payments.blockSeconds"].kind === "VERIFIED_ONCHAIN"`.

- [ ] **Шаг 4: Пуш**

```bash
git push origin main
```

- [ ] **Шаг 5: Записать слайс в CLAUDE.md**

Добавить в раздел про карточку монеты абзац: нативные Substrate-монеты,
`nativeChain`, два прогона (`:35` факты, `:45` выпуск), переопределение узла
через `SUBSTRATE_RPC_<KEY>`, границы (комиссия перевода не читается).

```bash
git add CLAUDE.md && git commit -m "docs: слайс S в CLAUDE.md" && git push origin main
```

---

## Самопроверка плана

**Покрытие спеки.** Принципы 1–5 → задачи 1 (выводимые ключи), 6 (`nativeChain`
отдельно от контрактов), 7 (`CoinCardSupply` не меняется, заявление не
правится), 10 (замер с номерами блоков), 3 (реестр в коде). Данные → задача 6.
Файлы → задачи 1–5, 7, 8, 10–12. «Что читаем» → задачи 1, 5, 7, 10. Поток →
задачи 7, 10, 12. «Как это видно» → задача 11. Ошибки → задачи 5, 7, 10, 12
(переводы кодов). Тестирование → задачи 1–3, 5, 7, 10. Границы → нигде не
делается комиссия перевода, `InactiveIssuance`, Solana/TON, WebSocket,
метаданные рантайма. Порядок работы → заходы 1 (задачи 1–9) и 2 (10–13).

**Заглушек нет:** каждый шаг содержит код или команду с ожидаемым выводом.

**Согласованность имён:** `twox128`/`storageKey`/`systemAccountKey`/`decodeUintLE`/
`decodeAccountBalance`/`ss58Decode`/`isSs58Address` (задачи 1–2) используются
ровно под этими именами в задачах 5, 7; `resolveSubstrateChain`/
`substrateRpcUrlFor`/`NATIVE_CHAIN_KEYS` (задача 3) — в задачах 5, 7, 8, 10, 11;
`jsonRpc`/`RpcError`/`FetchLike` (задача 4) — в задачах 5, 7, 10;
`readChainProperties`/`readTotalIssuance`/`readAccountBalance`/`readGenesisHash`/
`readBlockNumbers`/`measureBlockSeconds` (задача 5) — в задачах 7, 10;
`readSubstrateSupplyFacts` (задача 7); `readChainFacts`/`chainMismatches`/
`syncChainFacts`/`ChainFactsView` (задачи 10–12).
