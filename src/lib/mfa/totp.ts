/**
 * Код входа по стандарту TOTP (RFC 6238) — чистая часть второго фактора.
 *
 * Почему TOTP, а не письмо с кодом: через почту у нас идёт сброс пароля, и
 * второй фактор на письме совпал бы с первым путём восстановления (спека
 * `docs/superpowers/specs/2026-11-18-staff-second-factor-design.md`).
 *
 * Параметры — те, что понимает любое приложение без настройки: HMAC-SHA1,
 * шесть цифр, шаг тридцать секунд. SHA-1 здесь не про стойкость хеша: ключ
 * секретный, окно — тридцать секунд, а расхождение с телефоном человека дороже
 * теоретического выигрыша от SHA-256, которую часть приложений не читает из
 * ссылки.
 */
import { createHmac, randomBytes } from "node:crypto";

/** Шаг TOTP: тридцать секунд (RFC 6238, рекомендованный `X`). */
export const STEP_MS = 30_000;
/** Длина кода. */
export const DIGITS = 6;
/**
 * Допуск по шагам в обе стороны: часы телефона уходят, и один шаг — обычная
 * поправка. Два шага означали бы полторы минуты жизни подсмотренного кода.
 */
export const DRIFT_STEPS = 1;
/** Длина ключа: двадцать байт, как в векторах RFC 6238. */
export const SECRET_BYTES = 20;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // RFC 4648, base32

/** Ключ буквами — так его показывают человеку и так он лежит в ссылке приложения. */
export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Обратно. Пробелы и нижний регистр допускаются: ключ набирают руками, а
 * показывается он группами. Буква не из алфавита — исключение, а не тихий
 * пропуск: молча выброшенный символ дал бы другой ключ и «код не подходит»
 * без объяснения.
 */
export function base32Decode(text: string): Uint8Array {
  const clean = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`base32: unexpected character ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function newTotpSecret(): Uint8Array {
  return new Uint8Array(randomBytes(SECRET_BYTES));
}

/** Номер тридцатисекундного окна для времени в миллисекундах эпохи. */
export function stepFor(nowMs: number): number {
  return Math.floor(nowMs / STEP_MS);
}

/** Код для названного шага (RFC 4226 «dynamic truncation»). */
export function totpCode(secret: Uint8Array, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", Buffer.from(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export type TotpVerdict =
  | { ok: true; step: number }
  | { ok: false; reason: "code_invalid" | "code_reused" };

/**
 * Проверка кода. Принятый шаг возвращается наружу, чтобы его запомнили: без
 * этого один код годится все тридцать секунд, а с допуском — полторы минуты, и
 * подсмотренного через плечо кода хватает на вход.
 */
export function verifyTotp(input: {
  secret: Uint8Array;
  code: string;
  nowMs: number;
  lastStep?: number | null;
  driftSteps?: number;
}): TotpVerdict {
  const code = input.code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "code_invalid" };

  const drift = input.driftSteps ?? DRIFT_STEPS;
  const center = stepFor(input.nowMs);
  for (let step = center - drift; step <= center + drift; step++) {
    if (step < 0) continue;
    if (totpCode(input.secret, step) !== code) continue;
    if (input.lastStep !== null && input.lastStep !== undefined && step <= input.lastStep) {
      return { ok: false, reason: "code_reused" };
    }
    return { ok: true, step };
  }
  return { ok: false, reason: "code_invalid" };
}

/**
 * Ссылка для приложения. Нажатие на неё с телефона заводит фактор в один шаг —
 * поэтому в этом слайсе обошлись без QR: человек и так сидит в кабинете с
 * телефона, а ключ буквами остаётся для случая «кабинет на компьютере».
 */
export function otpauthUri(input: { issuer: string; account: string; secretB32: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({
    secret: input.secretB32,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_MS / 1000),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
