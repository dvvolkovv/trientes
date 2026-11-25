/**
 * Ссылка на чек. В базе лежит только sha256: дамп таблицы не должен давать чужие чеки
 * (прецедент — ссылка сброса пароля). Сама ссылка — предъявитель, как бумажный чек:
 * читает тот, у кого она есть, и показывают её QR-кодом с экрана кассы.
 */
import { createHash, randomBytes } from "node:crypto";
import { RECEIPT_TTL_DAYS } from "@/lib/sales/rules";

export function generateReceiptToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashReceiptToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function receiptExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + RECEIPT_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function receiptUrl(locale: string, token: string): string {
  const origin = (process.env.PUBLIC_ORIGIN ?? "https://trientes.org").replace(/\/+$/, "");
  return `${origin}/${locale}/receipt/${token}`;
}
