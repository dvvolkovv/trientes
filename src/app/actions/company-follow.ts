"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PUBLIC_COMPANY } from "@/lib/company-visibility";

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

/** Подписок на человека — потолок от перебора чужими руками, а не от человека. */
const MAX_FOLLOWS = 300;

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

/**
 * «Следить за магазином» — оно же согласие на рассылку (ТЗ 4.2). Строку создаёт
 * нажатие человека, и только она даёт магазину право ему написать: рассылок «по всей
 * базе» в проекте нет.
 */
export async function followCompany(companyId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  // Подписка предлагается только там, где есть витрина: следить за нелистованным или
  // снятым надзором предприятием значило бы ждать рассылку от того, кого не видно.
  const company = await prisma.company.findFirst({
    where: { id: companyId, ...PUBLIC_COMPANY },
    select: { id: true },
  });
  if (!company) return fail("not_found");

  const count = await prisma.companyFollow.count({ where: { userId } });
  if (count >= MAX_FOLLOWS) return fail("too_many");

  try {
    await prisma.companyFollow.create({ data: { userId, companyId } });
  } catch (e) {
    // Повторное нажатие — не ошибка: человек хотел быть подписанным, он подписан.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }
  revalidatePath(`/[locale]/companies/${companyId}`, "page");
  return { ok: true as const };
}

export async function unfollowCompany(companyId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  await prisma.companyFollow.deleteMany({ where: { userId, companyId } });
  revalidatePath(`/[locale]/companies/${companyId}`, "page");
  return { ok: true as const };
}

/** «Следить, но не писать мне» — отключение по магазину из ТЗ 4.3. */
export async function setFollowMuted(companyId: string, muted: boolean) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const updated = await prisma.companyFollow.updateMany({ where: { userId, companyId }, data: { muted } });
  if (updated.count === 0) return fail("not_following");
  return { ok: true as const, muted };
}

/** Общий выключатель рассылок магазинов. Канальные выключатели старше его. */
export async function setPromoNotifications(enabled: boolean) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  await prisma.user.update({ where: { id: userId }, data: { notifyPromos: enabled } });
  return { ok: true as const, enabled };
}
