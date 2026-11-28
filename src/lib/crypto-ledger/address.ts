/**
 * Адреса книги криптоучёта: семья сети, проверка формата и приведённый ключ
 * (слайс CR, спека `docs/superpowers/specs/2026-11-28-merchant-crypto-accounting-design.md`,
 * раздел 5.3).
 *
 * Зачем вообще проверять. Опечатка в адресе делает запись книги бессмысленной, а сверку
 * с санкционным списком — пустой: несуществующий адрес в списке не найдётся никогда.
 * Поэтому проверяем контрольную сумму — ровно то, для чего она в адресе и есть.
 *
 * Чего не утверждаем:
 * - **у EVM сеть по адресу не определяется вовсе** — один и тот же адрес живёт во всех
 *   цепях EVM, это свойство протокола, а не пробел нашей проверки;
 * - **в семье Bitcoin мы не утверждаем сеть**: версионные байты base58 у форков мы не
 *   сверяли живым запросом, а подставлять своё значение нельзя (то же решение, что у
 *   тикеров Cosmos в слайсе V — реестра денома нет, поле не проверено). Проверяем
 *   контрольную сумму, и пометка на экране говорит именно это.
 *
 * Регистр. У EVM он несёт контрольную сумму EIP-55 и `0xAb…` равен `0xab…`; у bech32
 * адрес по стандарту в одном регистре; у base58 регистр **значим**. Поэтому ключ сверки
 * считается по **виду самого адреса**, а не одним общим `toLowerCase()`, который однажды
 * склеил бы два разных адреса base58.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { base58Decode, ss58Decode } from "@/lib/substrate-codec";
import { EVM_CHAINS } from "@/lib/evm-chains";
import { SUBSTRATE_CHAINS } from "@/lib/substrate-chains";
import { COSMOS_CHAINS } from "@/lib/cosmos-chains";
import { BITCOIN_CHAINS } from "@/lib/bitcoin-chains";

export const ADDRESS_FAMILIES = ["EVM", "SUBSTRATE", "COSMOS", "BITCOIN"] as const;
export type AddressFamily = (typeof ADDRESS_FAMILIES)[number];

/** Адрес длиннее этого — не адрес: самый длинный живой короче сотни знаков. */
export const ADDRESS_MAX = 120;
export const ADDRESS_MIN = 16;
/** Хеш транзакции: от 32 знаков (Cosmos отдаёт 64 hex, EVM 66 с `0x`). */
export const TX_HASH_MAX = 120;

/**
 * Семья сети по тикеру монеты. Берётся из тех же реестров, которыми читаются карточки
 * монет: второй реестр под те же сети разошёлся бы с первым (болезнь списка локалей из
 * уборки AU). Тикер неоднозначен между семьями только у форков, которых в реестрах нет.
 */
export type CoinFamily =
  | { family: "EVM" }
  | { family: "SUBSTRATE"; ss58Format: number | null; label: string }
  | { family: "COSMOS"; bech32Prefix: string; label: string }
  | { family: "BITCOIN"; label: string }
  | null;

export function familyForCoin(coinRaw: string): CoinFamily {
  const coin = coinRaw.trim().toUpperCase();
  if (!coin) return null;

  const sub = SUBSTRATE_CHAINS.find((c) => c.symbol.toUpperCase() === coin);
  if (sub) return { family: "SUBSTRATE", ss58Format: sub.ss58Format, label: sub.label };

  const cos = COSMOS_CHAINS.find((c) => c.symbol.toUpperCase() === coin);
  if (cos) return { family: "COSMOS", bech32Prefix: cos.bech32Prefix, label: cos.label };

  const btc = BITCOIN_CHAINS.find((c) => c.symbol.toUpperCase() === coin);
  if (btc) return { family: "BITCOIN", label: btc.label };

  const evm = EVM_CHAINS.find((c) => c.symbol.toUpperCase() === coin);
  if (evm) return { family: "EVM" };

  // Токены на чужой цепи (USDT, USDC) по тикеру сеть не называют вовсе: один тикер живёт
  // в десяти цепях. Угадывать нельзя — честный ответ «семья неизвестна».
  return null;
}

/* ─── bech32 (Cosmos и segwit) ─────────────────────────────────────────────── */

const BECH32_ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bech32Polymod(values: readonly number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) if ((top >> i) & 1) chk ^= BECH32_GEN[i];
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const ch of hrp) out.push(ch.charCodeAt(0) >> 5);
  out.push(0);
  for (const ch of hrp) out.push(ch.charCodeAt(0) & 31);
  return out;
}

export type Bech32Parts = { hrp: string; dataLength: number; variant: "bech32" | "bech32m" };

/**
 * Разбор bech32/bech32m с проверкой контрольной суммы. Оба варианта принимаются: segwit
 * v0 подписан по bech32, v1 (taproot) — по bech32m, и отвергать второй значило бы
 * отвергать живой адрес Bitcoin.
 */
export function bech32Decode(input: string): Bech32Parts | null {
  const text = input.trim();
  if (text.length < 8 || text.length > 110) return null;
  const lower = text.toLowerCase();
  const upper = text.toUpperCase();
  // Смешанный регистр стандарт запрещает: он ломает единственность записи.
  if (text !== lower && text !== upper) return null;

  const sep = lower.lastIndexOf("1");
  if (sep < 1 || sep + 7 > lower.length) return null;
  const hrp = lower.slice(0, sep);
  if (!/^[\x21-\x7e]+$/.test(hrp)) return null;

  const data: number[] = [];
  for (const ch of lower.slice(sep + 1)) {
    const value = BECH32_ALPHABET.indexOf(ch);
    if (value < 0) return null;
    data.push(value);
  }

  const checksum = bech32Polymod([...bech32HrpExpand(hrp), ...data]);
  const variant = checksum === 1 ? "bech32" : checksum === 0x2bc830a3 ? "bech32m" : null;
  if (!variant) return null;

  return { hrp, dataLength: data.length - 6, variant };
}

/* ─── base58check (Bitcoin и форки) ───────────────────────────────────────── */

/** Контрольная сумма base58check: четыре байта двойного sha256. */
export function base58CheckDecode(input: string): Uint8Array | null {
  const raw = base58Decode(input.trim());
  if (!raw || raw.length < 5) return null;
  const body = raw.slice(0, raw.length - 4);
  const given = raw.slice(raw.length - 4);
  const sum = sha256(sha256(body));
  for (let i = 0; i < 4; i += 1) if (sum[i] !== given[i]) return null;
  return body;
}

/* ─── EVM ─────────────────────────────────────────────────────────────────── */

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Контрольная сумма EIP-55. Проверяется **только** у адреса со смешанным регистром:
 * адрес в одном регистре контрольной суммы не несёт вовсе, и отвергать его значило бы
 * отвергать то, что печатают половина обозревателей.
 */
export function isEvmAddress(input: string): boolean {
  const text = input.trim();
  if (!EVM_RE.test(text)) return false;
  const body = text.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  const hash = keccak_256(new TextEncoder().encode(body.toLowerCase()));
  for (let i = 0; i < 40; i += 1) {
    const nibble = (hash[i >> 1] >> (i % 2 === 0 ? 4 : 0)) & 0xf;
    const ch = body[i];
    if (/[0-9]/.test(ch)) continue;
    const upper = nibble >= 8;
    if (upper !== (ch === ch.toUpperCase())) return false;
  }
  return true;
}

/* ─── общий разбор ────────────────────────────────────────────────────────── */

export type AddressCheck =
  | { ok: true; family: AddressFamily | null; address: string; key: string }
  | { ok: false; reason: "address_empty" | "address_too_short" | "address_too_long" | "address_invalid" | "address_wrong_network" };

/**
 * Ключ сверки с санкционным списком. Считается **по виду самого адреса**, а не по
 * заявленной монете: токен (`USDT`, `USDC`) сеть по тикеру не называет вовсе, а в
 * санкционном списке тот же адрес лежит под активом `USDT` строчными буквами — сверка по
 * заявленной семье его бы не нашла.
 *
 * Правило: адрес вида EVM и годный bech32 приводятся к нижнему регистру (регистр у них
 * либо несёт контрольную сумму, либо запрещён стандартом), всё остальное остаётся как
 * набрано — у base58 регистр значим, и приведение склеило бы два разных адреса.
 */
export function addressKey(address: string): string {
  const text = address.trim();
  if (EVM_RE.test(text)) return text.toLowerCase();
  if (bech32Decode(text)) return text.toLowerCase();
  return text;
}

/**
 * Проверка адреса под монету. Знаем семью — проверяем контрольную сумму и, где адрес
 * её несёт, принадлежность сети (SS58-префикс у Substrate, hrp у Cosmos). Не знаем —
 * принимаем и отдаём `family: null`: экран скажет «формат не проверен», а не выдаст
 * непроверенное за проверенное.
 */
export function checkAddress(addressRaw: string, coin: string): AddressCheck {
  const address = addressRaw.trim();
  if (!address) return { ok: false, reason: "address_empty" };
  if (address.length < ADDRESS_MIN) return { ok: false, reason: "address_too_short" };
  if (address.length > ADDRESS_MAX) return { ok: false, reason: "address_too_long" };
  // Пробелы и управляющие знаки внутри адреса — это склейка двух строк, а не адрес.
  if (/[\s --]/.test(address)) return { ok: false, reason: "address_invalid" };

  const fam = familyForCoin(coin);
  if (!fam) return { ok: true, family: null, address, key: addressKey(address) };

  if (fam.family === "EVM") {
    if (!isEvmAddress(address)) return { ok: false, reason: "address_invalid" };
    return { ok: true, family: "EVM", address, key: addressKey(address) };
  }

  if (fam.family === "SUBSTRATE") {
    const parts = ss58Decode(address);
    if (!parts) return { ok: false, reason: "address_invalid" };
    if (fam.ss58Format !== null && parts.prefix !== fam.ss58Format) {
      return { ok: false, reason: "address_wrong_network" };
    }
    return { ok: true, family: "SUBSTRATE", address, key: addressKey(address) };
  }

  if (fam.family === "COSMOS") {
    const parts = bech32Decode(address);
    if (!parts) return { ok: false, reason: "address_invalid" };
    if (parts.hrp !== fam.bech32Prefix) return { ok: false, reason: "address_wrong_network" };
    return { ok: true, family: "COSMOS", address, key: addressKey(address) };
  }

  // Bitcoin: контрольная сумма сходится, сеть не утверждаем (разбор в шапке модуля).
  if (bech32Decode(address) || base58CheckDecode(address)) {
    return { ok: true, family: "BITCOIN", address, key: addressKey(address) };
  }
  return { ok: false, reason: "address_invalid" };
}

/** Хеш транзакции: форму чужой сети не навязываем, но склейку строк отвергаем. */
export function checkTxHash(raw: string): { ok: true; value: string } | { ok: false } {
  const text = raw.trim();
  if (!text) return { ok: true, value: "" };
  if (text.length < 16 || text.length > TX_HASH_MAX) return { ok: false };
  if (!/^[0-9a-zA-Z:_-]+$/.test(text)) return { ok: false };
  return { ok: true, value: text };
}
