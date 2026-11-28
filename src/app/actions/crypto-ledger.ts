"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getViewerCompanyById, canEditSection } from "@/lib/business";
import { logCompanyAction } from "@/lib/company-team/journal";
import {
  DAILY_CRYPTO_OPS,
  validateCryptoAddress,
  validateCryptoOp,
  type CryptoAddressReason,
  type CryptoOpReason,
} from "@/lib/crypto-ledger/rules";

/**
 * Книга криптоучёта (слайс CR, ТЗ 6.8).
 *
 * Право — `reports` (CL): книга монет это бухгалтерия, и ведёт её тот же человек,
 * который видит чеки и выгружает их для консультанта. Калитка спрашивается **в самом
 * действии**, а не только на экране: серверное действие вызывается прямым запросом (дыра,
 * которую живой прогон BA нашёл у `startMfaEnrollment`).
 */
async function gate(companyId: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!userId) return { userId: null, companyId: null as string | null };
  const { company, permissions } = await getViewerCompanyById(companyId);
  if (!company || company.suspendedAt || company.deletedAt) return { userId, companyId: null };
  if (!canEditSection(permissions, "reports")) return { userId, companyId: null };
  return { userId, companyId: company.id };
}

type Fail<R extends string> = { ok: false; reason: R | "unauth" | "forbidden" };

export async function addCryptoAddress(input: {
  companyId: string;
  coin: string;
  address: string;
  label: string;
}): Promise<{ ok: true; sanctioned: boolean } | Fail<CryptoAddressReason | "address_taken">> {
  const g = await gate(input.companyId);
  if (!g.userId) return { ok: false, reason: "unauth" };
  if (!g.companyId) return { ok: false, reason: "forbidden" };

  const addressCount = await prisma.companyCryptoAddress.count({
    where: { companyId: g.companyId, archivedAt: null },
  });
  const checked = validateCryptoAddress(
    { coin: input.coin, address: input.address, label: input.label },
    { addressCount },
  );
  if (!checked.ok) return { ok: false, reason: checked.reason };

  try {
    await prisma.companyCryptoAddress.create({
      data: {
        companyId: g.companyId,
        coin: checked.value.coin,
        address: checked.value.address,
        addressKey: checked.value.addressKey,
        family: checked.value.family,
        label: checked.value.label,
        createdById: g.userId,
      },
    });
  } catch {
    // Тот же адрес у того же предприятия — не вторая запись, а повтор нажатия.
    return { ok: false, reason: "address_taken" };
  }

  await logCompanyAction({
    companyId: g.companyId,
    actorUserId: g.userId,
    action: "CRYPTO_ADDRESS_ADDED",
    subject: `${checked.value.coin} ${checked.value.address}`,
  });

  // Санкционная пометка считается сразу: заводящий адрес вправе узнать об этом в тот
  // же миг, а не из ночного прогона.
  const hit = await prisma.sanctionedCryptoAddress.findFirst({
    where: { addressKey: checked.value.addressKey },
    select: { id: true },
  });

  revalidatePath(`/cabinet/companies/${g.companyId}/crypto`);
  return { ok: true, sanctioned: Boolean(hit) };
}

export async function archiveCryptoAddress(input: {
  companyId: string;
  addressId: string;
  archived: boolean;
}): Promise<{ ok: true } | Fail<"not_found">> {
  const g = await gate(input.companyId);
  if (!g.userId) return { ok: false, reason: "unauth" };
  if (!g.companyId) return { ok: false, reason: "forbidden" };

  // Архив, а не удаление: по адресу уже записаны приходы (правило BC о складах).
  const done = await prisma.companyCryptoAddress.updateMany({
    where: { id: input.addressId, companyId: g.companyId },
    data: { archivedAt: input.archived ? new Date() : null },
  });
  if (done.count === 0) return { ok: false, reason: "not_found" };

  const row = await prisma.companyCryptoAddress.findUnique({
    where: { id: input.addressId },
    select: { coin: true, address: true },
  });
  if (input.archived) {
    await logCompanyAction({
      companyId: g.companyId,
      actorUserId: g.userId,
      action: "CRYPTO_ADDRESS_ARCHIVED",
      subject: row ? `${row.coin} ${row.address}` : null,
    });
  }
  revalidatePath(`/cabinet/companies/${g.companyId}/crypto`);
  return { ok: true };
}

export async function recordCryptoOp(input: {
  companyId: string;
  kind: string;
  coin: string;
  amount: string;
  rate: string;
  currency: string;
  happenedAt: string;
  address: string;
  txHash: string;
  note: string;
}): Promise<{ ok: true } | Fail<CryptoOpReason>> {
  const g = await gate(input.companyId);
  if (!g.userId) return { ok: false, reason: "unauth" };
  if (!g.companyId) return { ok: false, reason: "forbidden" };

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600_000);
  // Счёт до работы — тот же приём, что `DAILY_MOVEMENTS` в BC.
  const opsToday = await prisma.companyCryptoOperation.count({
    where: { companyId: g.companyId, createdAt: { gte: dayAgo } },
  });
  if (opsToday >= DAILY_CRYPTO_OPS) return { ok: false, reason: "daily_limit" };

  const checked = validateCryptoOp(
    {
      kind: input.kind,
      coin: input.coin,
      amount: input.amount,
      rate: input.rate,
      currency: input.currency,
      happenedAt: input.happenedAt,
      address: input.address,
      txHash: input.txHash,
      note: input.note,
    },
    { opsToday, now },
  );
  if (!checked.ok) return { ok: false, reason: checked.reason };

  const v = checked.value;
  await prisma.companyCryptoOperation.create({
    data: {
      companyId: g.companyId,
      kind: v.kind,
      coin: v.coin,
      amount: v.amount,
      rate: v.rate,
      currency: v.currency,
      fiatAmount: v.fiatAmount,
      happenedAt: v.happenedAt,
      address: v.address,
      txHash: v.txHash,
      note: v.note,
      createdById: g.userId,
    },
  });
  await logCompanyAction({
    companyId: g.companyId,
    actorUserId: g.userId,
    action: "CRYPTO_OP_RECORDED",
    subject: `${v.kind} ${v.amount} ${v.coin}`,
  });
  revalidatePath(`/cabinet/companies/${g.companyId}/crypto`);
  return { ok: true };
}

/**
 * Удаление строки книги. Почему удаление, а не отмена встречной строкой, как у движения
 * склада в BC: движение описывает **случившееся** событие склада, а строка книги — это
 * запись о чужом событии, и ошибочно набранная строка не событие вовсе. Чеки кассы при
 * этом неизменяемы и этой дверью не правятся: их автор — касса.
 */
export async function deleteCryptoOp(input: {
  companyId: string;
  opId: string;
}): Promise<{ ok: true } | Fail<"not_found">> {
  const g = await gate(input.companyId);
  if (!g.userId) return { ok: false, reason: "unauth" };
  if (!g.companyId) return { ok: false, reason: "forbidden" };

  const row = await prisma.companyCryptoOperation.findFirst({
    where: { id: input.opId, companyId: g.companyId },
    select: { id: true, kind: true, coin: true, amount: true },
  });
  if (!row) return { ok: false, reason: "not_found" };

  await prisma.companyCryptoOperation.delete({ where: { id: row.id } });
  await logCompanyAction({
    companyId: g.companyId,
    actorUserId: g.userId,
    action: "CRYPTO_OP_DELETED",
    subject: `${row.kind} ${Number(row.amount)} ${row.coin}`,
  });
  revalidatePath(`/cabinet/companies/${g.companyId}/crypto`);
  return { ok: true };
}
