/**
 * Секрет подписи webhook в базе лежит **зашифрованным**, а не захешированным: по нему
 * считается HMAC каждой доставки (дословно разбор ключа TOTP в слайсе BA). Дамп таблицы
 * без ключа приложения не должен давать возможность подписаться нашим именем.
 *
 * Шифр тот же — AES-256-GCM из `src/lib/mfa/secret-store.ts`, второй реализации не
 * заводим. Ключ **свой** (`AUTOMATION_SECRET_KEY`): второй фактор сотрудника и подпись
 * оповещений — разные вещи с разным сроком жизни, и смена одного ключа не должна ломать
 * другое.
 *
 * Нет ключа — раздела исходящих событий нет вовсе (правило AV и CI: дверь, ведущая в
 * тишину, хуже отсутствия двери).
 */
import { mfaKeyFrom, openSecret, sealSecret } from "@/lib/mfa/secret-store";

export function automationKeyConfigured(): boolean {
  return /^[0-9a-fA-F]{64}$/.test((process.env.AUTOMATION_SECRET_KEY ?? "").trim());
}

/** Ключ читается при каждом обращении: без него должен падать webhook, а не сборка. */
function key() {
  return mfaKeyFrom(process.env.AUTOMATION_SECRET_KEY);
}

export function sealWebhookSecret(secret: string): string {
  return sealSecret(new TextEncoder().encode(secret), key());
}

export function openWebhookSecret(sealed: string): string {
  return new TextDecoder().decode(openSecret(sealed, key()));
}
