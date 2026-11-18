/**
 * Ключ TOTP в базе лежит зашифрованным.
 *
 * Хешировать его нельзя — по ключу считается код, — поэтому дамп таблицы без
 * ключа приложения не должен давать второй фактор. Тот же ход мысли, что у
 * токенов сброса пароля (в базе только sha256) и у приватного корня вложений
 * комплайнса: дамп не должен быть входом.
 *
 * AES-256-GCM: шифр со встроенной проверкой целостности — подменённый байт
 * даёт отказ, а не другой ключ, который молча выдавал бы «код не подходит».
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12; // рекомендованная длина вектора для GCM
const KEY_BYTES = 32;

/** Ключ приложения из строки `.env` (64 шестнадцатеричных знака). */
export function mfaKeyFrom(raw: string | undefined): Buffer {
  const text = (raw ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(text)) {
    throw new Error("MFA_SECRET_KEY must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(text, "hex");
}

/**
 * Ключ приложения из окружения. Читается при каждом обращении, а не один раз
 * при загрузке модуля: без ключа должен падать вход сотрудника, а не сборка
 * всего сайта.
 */
export function mfaKey(): Buffer {
  const key = mfaKeyFrom(process.env.MFA_SECRET_KEY);
  if (key.length !== KEY_BYTES) throw new Error("MFA_SECRET_KEY must be 32 bytes");
  return key;
}

/** `iv:tag:ciphertext`, каждое — base64url. */
export function sealSecret(secret: Uint8Array, key: Buffer = mfaKey()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(Buffer.from(secret)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, body].map((b) => b.toString("base64url")).join(":");
}

export function openSecret(sealed: string, key: Buffer = mfaKey()): Uint8Array {
  const parts = sealed.split(":");
  if (parts.length !== 3) throw new Error("sealed secret: unexpected shape");
  const [iv, tag, body] = parts.map((p) => Buffer.from(p, "base64url"));
  if (!iv || iv.length !== IV_BYTES) throw new Error("sealed secret: unexpected iv");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag!);
  return new Uint8Array(Buffer.concat([decipher.update(body!), decipher.final()]));
}
