/**
 * Второй фактор: работа с базой. Чистые правила — в `policy.ts` и `totp.ts`,
 * здесь только чтение и запись.
 */
import { prisma } from "@/lib/prisma";
import { openSecret, sealSecret } from "@/lib/mfa/secret-store";
import { hashRecoveryCode, newRecoveryCodes } from "@/lib/mfa/recovery";
import { base32Encode, base32Decode, newTotpSecret, otpauthUri, verifyTotp } from "@/lib/mfa/totp";

export const MFA_ISSUER = "Trientes";

export type MfaRow = {
  confirmedAt: Date | null;
  disabledAt: Date | null;
};

export async function readMfa(userId: string): Promise<MfaRow | null> {
  return prisma.staffMfa.findUnique({
    where: { userId },
    select: { confirmedAt: true, disabledAt: true },
  });
}

/**
 * Начало заведения: новый ключ, строка без подтверждения. Поверх прежней
 * неподтверждённой пишем свободно — человек мог бросить заведение на середине
 * или сменить телефон; поверх **подтверждённой** тоже, и это не дыра: чтобы
 * сюда попасть, нужен действующий сеанс, а новый ключ без подтверждения
 * прежний фактор не отменяет (`confirmedAt` ставится только с кодом).
 */
export async function beginEnrollment(
  userId: string,
  account: string,
): Promise<{ secretB32: string; uri: string }> {
  const secret = newTotpSecret();
  const secretB32 = base32Encode(secret);
  const secretEnc = sealSecret(secret);
  await prisma.staffMfa.upsert({
    where: { userId },
    create: { userId, secretEnc },
    update: { secretEnc, confirmedAt: null, lastStep: null, disabledAt: null, disabledById: null, disabledReason: null },
  });
  return { secretB32, uri: otpauthUri({ issuer: MFA_ISSUER, account, secretB32 }) };
}

export type MfaFailure =
  | "not_enrolled"
  | "code_invalid"
  | "code_reused"
  | "rate_limited"
  | "unreadable";

/**
 * Проверка кода и — при удаче — отметка шага. Шаг пишется условным `updateMany`
 * по прежнему значению: два одновременных запроса с одним кодом иначе прошли бы
 * оба, и повтор, от которого защищает `lastStep`, стал бы возможен.
 */
export async function checkCode(input: {
  userId: string;
  code: string;
  nowMs?: number;
}): Promise<{ ok: true } | { ok: false; reason: MfaFailure }> {
  const row = await prisma.staffMfa.findUnique({
    where: { userId: input.userId },
    select: { secretEnc: true, lastStep: true, disabledAt: true },
  });
  if (!row || row.disabledAt) return { ok: false, reason: "not_enrolled" };

  let secret: Uint8Array;
  try {
    secret = openSecret(row.secretEnc);
  } catch {
    // Ключ приложения сменился или строка повреждена: честный отказ, а не
    // «код не подходит» — иначе человек будет набирать верные коды вечно.
    return { ok: false, reason: "unreadable" };
  }

  const lastStep = row.lastStep === null ? null : Number(row.lastStep);
  const verdict = verifyTotp({
    secret,
    code: input.code,
    nowMs: input.nowMs ?? Date.now(),
    lastStep,
  });
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  const written = await prisma.staffMfa.updateMany({
    where: { userId: input.userId, lastStep: row.lastStep },
    data: { lastStep: BigInt(verdict.step) },
  });
  if (written.count === 0) return { ok: false, reason: "code_reused" };
  return { ok: true };
}

/** Подтверждение заведения: тот же код, плюс коды восстановления одним экраном. */
export async function confirmEnrollment(input: {
  userId: string;
  code: string;
}): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; reason: MfaFailure }> {
  const checked = await checkCode(input);
  if (!checked.ok) return checked;

  const codes = newRecoveryCodes();
  await prisma.$transaction([
    prisma.staffMfaRecoveryCode.deleteMany({ where: { userId: input.userId } }),
    prisma.staffMfa.update({ where: { userId: input.userId }, data: { confirmedAt: new Date() } }),
    prisma.staffMfaRecoveryCode.createMany({
      data: codes.map((code) => ({ userId: input.userId, codeHash: hashRecoveryCode(code) })),
    }),
  ]);
  return { ok: true, recoveryCodes: codes };
}

/**
 * Код восстановления. Гасится условным `updateMany` по `usedAt: null` — два
 * одновременных перехода одним кодом не пройдут оба (тот же приём, что у ссылки
 * сброса пароля и приглашения в команду).
 */
export async function useRecoveryCode(input: {
  userId: string;
  code: string;
}): Promise<{ ok: true; left: number } | { ok: false; reason: "code_invalid" | "not_enrolled" }> {
  const mfa = await prisma.staffMfa.findUnique({
    where: { userId: input.userId },
    select: { confirmedAt: true, disabledAt: true },
  });
  if (!mfa || mfa.disabledAt || !mfa.confirmedAt) return { ok: false, reason: "not_enrolled" };

  const hash = hashRecoveryCode(input.code);
  const burned = await prisma.staffMfaRecoveryCode.updateMany({
    where: { userId: input.userId, codeHash: hash, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (burned.count === 0) return { ok: false, reason: "code_invalid" };
  const left = await prisma.staffMfaRecoveryCode.count({
    where: { userId: input.userId, usedAt: null },
  });
  return { ok: true, left };
}

export async function recoveryCodesLeft(userId: string): Promise<number> {
  return prisma.staffMfaRecoveryCode.count({ where: { userId, usedAt: null } });
}

/** Штамп сеанса: с него и только с него открывается админка. */
export async function stampSession(sessionToken: string): Promise<void> {
  await prisma.session.updateMany({
    where: { sessionToken },
    data: { mfaAt: new Date() },
  });
}

/**
 * Снятие фактора владельцем. Прежние сеансы сотрудника гасятся: иначе снятый
 * фактор оставался бы «показанным» в живом сеансе, и смысл снятия (телефон
 * потерян, доступ под вопросом) терялся бы.
 */
export async function disableMfa(input: {
  targetUserId: string;
  byUserId: string;
  reason: string;
}): Promise<void> {
  await prisma.$transaction([
    prisma.staffMfa.update({
      where: { userId: input.targetUserId },
      data: {
        disabledAt: new Date(),
        disabledById: input.byUserId,
        disabledReason: input.reason,
        confirmedAt: null,
        lastStep: null,
      },
    }),
    prisma.staffMfaRecoveryCode.deleteMany({ where: { userId: input.targetUserId } }),
    prisma.session.deleteMany({ where: { userId: input.targetUserId } }),
  ]);
}

/** Ключ в буквах — только для экрана заведения, когда строка ещё не подтверждена. */
export async function readPendingSecretB32(userId: string): Promise<string | null> {
  const row = await prisma.staffMfa.findUnique({
    where: { userId },
    select: { secretEnc: true, confirmedAt: true },
  });
  if (!row || row.confirmedAt) return null;
  try {
    return base32Encode(base32Decode(base32Encode(openSecret(row.secretEnc))));
  } catch {
    return null;
  }
}
