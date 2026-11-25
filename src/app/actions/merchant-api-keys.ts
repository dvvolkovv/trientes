"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logCompanyAction } from "@/lib/company-team/journal";
import { getViewerCompanyById } from "@/lib/business";
import {
  MAX_API_KEYS,
  REVOKE_REASON_MIN,
  apiKeyPrefix,
  generateApiKey,
  hashApiKey,
  keyNameValid,
} from "@/lib/merchant-api/keys";

/**
 * Ключи read-only API предприятия (слайс CL, ТЗ 6.4).
 *
 * Выдаёт и отзывает **только владелец** (как команда и KYB): ключ читает все продажи
 * предприятия мимо кабинета, то есть это выдача прав, а не работа с данными — тот же
 * разбор, которым AS оставил выдачу прав сотрудникам владельцу платформы.
 */
async function ownerGate(companyId: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!userId) return { userId: null, companyId: null as string | null };
  const { company, role } = await getViewerCompanyById(companyId);
  if (!company || role !== "OWNER") return { userId, companyId: null };
  return { userId, companyId: company.id };
}

export async function createApiKey(input: { companyId: string; name: string }) {
  const gate = await ownerGate(input.companyId);
  if (!gate.userId) return { ok: false as const, reason: "unauth" as const };
  if (!gate.companyId) return { ok: false as const, reason: "forbidden" as const };
  if (!keyNameValid(input.name)) return { ok: false as const, reason: "name_invalid" as const };

  const live = await prisma.merchantApiKey.count({
    where: { companyId: gate.companyId, revokedAt: null },
  });
  if (live >= MAX_API_KEYS) return { ok: false as const, reason: "too_many" as const };

  const token = generateApiKey();
  await prisma.merchantApiKey.create({
    data: {
      companyId: gate.companyId,
      name: input.name.trim(),
      prefix: apiKeyPrefix(token),
      keyHash: hashApiKey(token),
      createdById: gate.userId,
    },
  });
  await logCompanyAction({
    companyId: gate.companyId,
    actorUserId: gate.userId,
    action: "API_KEY_CREATED",
    subject: input.name.trim(),
  });
  revalidatePath(`/cabinet/companies/${gate.companyId}/reports`);
  // Сам ключ возвращается ровно один раз — в этом ответе. В базе только его sha256.
  return { ok: true as const, token };
}

export async function revokeApiKey(input: { companyId: string; keyId: string; reason: string }) {
  const gate = await ownerGate(input.companyId);
  if (!gate.userId) return { ok: false as const, reason: "unauth" as const };
  if (!gate.companyId) return { ok: false as const, reason: "forbidden" as const };
  const reason = input.reason.trim();
  if (reason.length < REVOKE_REASON_MIN) return { ok: false as const, reason: "reason_required" as const };

  // Отзыв строку не удаляет: по журналу должно читаться, какой ключ работал и почему
  // его сняли (то же решение, что отзыв доступа сотрудника в AS).
  const done = await prisma.merchantApiKey.updateMany({
    where: { id: input.keyId, companyId: gate.companyId, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: gate.userId, revokeReason: reason },
  });
  if (done.count === 0) return { ok: false as const, reason: "not_found" as const };

  const row = await prisma.merchantApiKey.findUnique({
    where: { id: input.keyId },
    select: { name: true },
  });
  await logCompanyAction({
    companyId: gate.companyId,
    actorUserId: gate.userId,
    action: "API_KEY_REVOKED",
    subject: row?.name ?? null,
    meta: { reason },
  });
  revalidatePath(`/cabinet/companies/${gate.companyId}/reports`);
  return { ok: true as const };
}
