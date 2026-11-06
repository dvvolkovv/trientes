/**
 * Минимальный ABI-слой под слайс B: четыре геттера ERC-20 и поиск селекторов
 * в байткоде. Полная ABI-библиотека сюда не тянется — нам нужны вызовы без
 * аргументов и три типа возврата, а keccak для фиксированных селекторов
 * считать незачем: это константы, одинаковые у всех ERC-20.
 */

/** Префиксы keccak256 от подписи функции — фиксированные значения. */
export const SELECTORS = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
  owner: "0x8da5cb5b",
  mint: "0x40c10f19", // mint(address,uint256)
  pause: "0x8456cb59", // pause()
  paused: "0x5c975abb", // paused()
  blacklist: "0xf9f92be4", // blacklist(address)
  isBlacklisted: "0xfe575a87", // isBlacklisted(address)
  upgradeTo: "0x3659cfe6", // upgradeTo(address)
} as const;

/** Слот реализации EIP-1967: keccak256("eip1967.proxy.implementation") - 1. */
export const EIP1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export class DecodeError extends Error {
  constructor() {
    super("decode_failed");
  }
}

export function isEvmAddress(value: string | null | undefined): boolean {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

/** Нижний регистр: адреса сравниваем только так, EIP-55 — лишь контрольная сумма. */
export function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function strip(hex: string): string {
  if (typeof hex !== "string") throw new DecodeError();
  const h = hex.trim().toLowerCase();
  if (!h.startsWith("0x") || !/^0x[0-9a-f]*$/.test(h)) throw new DecodeError();
  return h.slice(2);
}

function word(body: string, index: number): string {
  const w = body.slice(index * 64, index * 64 + 64);
  if (w.length !== 64) throw new DecodeError();
  return w;
}

function hexToUtf8(hex: string): string {
  const bytes: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
}

/**
 * Строка ERC-20 приходит в двух видах: правильная динамическая строка и
 * bytes32 у токенов, написанных до того, как стандарт устоялся (MKR). Оба
 * случая настоящие, поэтому понимаем оба.
 */
export function decodeString(hex: string): string {
  const body = strip(hex);
  if (body.length === 0) throw new DecodeError();

  // Ровно одно слово — это bytes32, дополненный нулями справа.
  if (body.length === 64) {
    const trimmed = body.replace(/(?:00)+$/, "");
    if (trimmed.length % 2 !== 0) throw new DecodeError();
    return hexToUtf8(trimmed).trim();
  }

  const offset = Number(BigInt("0x" + word(body, 0)));
  if (!Number.isSafeInteger(offset) || offset % 32 !== 0) throw new DecodeError();
  const base = offset * 2;
  const lenHex = body.slice(base, base + 64);
  if (lenHex.length !== 64) throw new DecodeError();
  const len = Number(BigInt("0x" + lenHex));
  if (!Number.isSafeInteger(len) || len > 4096) throw new DecodeError();
  const data = body.slice(base + 64, base + 64 + len * 2);
  if (data.length !== len * 2) throw new DecodeError();
  return hexToUtf8(data).trim();
}

/** uint256 как десятичная строка: в number он не влезает, а BigInt не сериализуется. */
export function decodeUint(hex: string): string {
  const body = strip(hex);
  if (body.length !== 64) throw new DecodeError();
  return BigInt("0x" + body).toString();
}

/** decimals — uint8; всё, что больше 255, это не decimals, а мусор. */
export function decodeUint8(hex: string): number {
  const v = BigInt(decodeUint(hex));
  if (v > BigInt(255)) throw new DecodeError();
  return Number(v);
}

/** Есть ли в байткоде 4-байтовый селектор. Грубо, но без ложных «функции нет». */
export function hasSelector(bytecode: string, selector: string): boolean {
  if (typeof bytecode !== "string" || typeof selector !== "string") return false;
  const code = bytecode.trim().toLowerCase().replace(/^0x/, "");
  const sel = selector.trim().toLowerCase().replace(/^0x/, "");
  if (code.length === 0 || sel.length !== 8) return false;
  return code.includes(sel);
}

/** Пустой код по адресу значит, что это кошелёк, а не токен. */
export function isEmptyBytecode(bytecode: string | null | undefined): boolean {
  if (typeof bytecode !== "string") return true;
  const code = bytecode.trim().toLowerCase().replace(/^0x/, "");
  return code.length === 0 || /^0+$/.test(code);
}

/**
 * Код EOA с делегацией EIP-7702 — это `0xef0100` + адрес. Такой адрес отвечает
 * непустым байткодом, но контрактом не является: без этой проверки кошелёк
 * Виталика проходил сверку как «контракт со всеми полями null».
 */
export function isDelegatedEoa(bytecode: string | null | undefined): boolean {
  if (typeof bytecode !== "string") return false;
  const code = bytecode.trim().toLowerCase().replace(/^0x/, "");
  return code.startsWith("ef0100");
}

/** Адрес реализации из слота EIP-1967; null, если слот пуст. */
export function implementationFromSlot(slotValue: string | null | undefined): string | null {
  if (typeof slotValue !== "string") return null;
  let body: string;
  try {
    body = strip(slotValue);
  } catch {
    return null;
  }
  if (body.length < 40) return null;
  const addr = "0x" + body.slice(-40);
  if (/^0x0+$/.test(addr)) return null;
  return addr;
}
