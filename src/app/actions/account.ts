"use server";

import { cookies } from "next/headers";
import { unlink } from "node:fs/promises";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { hashPassword, verifyPassword } from "@/lib/password";
import { validateUsername } from "@/lib/username";
import { validateProfileInput, type ProfileInput } from "@/lib/profile";
import { loadMfaGate } from "@/lib/authz/guard";
import { authSessionCookieName } from "@/lib/session";
import { avatarFilePath } from "@/lib/avatar";
import { channelsBeforeChange, stampContactChange } from "@/lib/pay-link/freeze";

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

/**
 * Кто перед нами — и показал ли он второй фактор, если тот заведён.
 *
 * Проверка не только на странице: страница кабинета отправляет на ввод кода
 * сама, но серверное действие вызывается прямым запросом, и без этой строки
 * украденного пароля хватало бы, чтобы сменить почту и пароль мимо фактора —
 * ровно та дыра, которую живой прогон слайса BA нашёл у `startMfaEnrollment`.
 */
async function requireOwnAccount(): Promise<
  { ok: true; userId: string } | { ok: false; reason: string }
> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, reason: "unauth" };
  if ((await loadMfaGate()) === "verify") return { ok: false, reason: "verify_first" };
  return { ok: true, userId };
}

export async function setUsername(next: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const me = await requireOwnAccount();
  if (!me.ok) return me;
  const userId = me.userId;
  const v = validateUsername(next);
  if (!v.ok) return { ok: false, reason: v.reason };
  try {
    await prisma.user.update({ where: { id: userId }, data: { username: v.value } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, reason: "username_taken" };
    }
    throw err;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateProfile(input: ProfileInput): Promise<{ ok: true } | { ok: false; reason: string }> {
  const me = await requireOwnAccount();
  if (!me.ok) return me;
  const userId = me.userId;
  const v = validateProfileInput(input);
  if (!v.ok) return { ok: false, reason: v.reason };
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const emailChanged = (current?.email ?? null) !== v.data.email;
  // Каналы **до** правки: весть о смене почты уходит на старый адрес, и снимать его
  // надо пока он ещё на месте (слайс CP). Смена канала замораживает приём платежей
  // на сутки — иначе захватчик сначала меняет почту на свою, и отложенная смена
  // ссылки оплаты проходит молча.
  const channelsBefore = emailChanged ? await channelsBeforeChange(userId) : null;
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        firstName: v.data.firstName,
        lastName: v.data.lastName,
        phone: v.data.phone,
        email: v.data.email,
        ...(emailChanged ? { emailVerified: null } : {}),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, reason: "email_taken" };
    }
    throw err;
  }
  if (emailChanged && channelsBefore) {
    await stampContactChange({ userId, channel: "email", before: channelsBefore });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function changePassword(oldPw: string, newPw: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const me = await requireOwnAccount();
  if (!me.ok) return me;
  const userId = me.userId;
  if (newPw.length < 8) return { ok: false, reason: "password_too_short" };
  if (newPw.length > 200) return { ok: false, reason: "password_too_long" };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user?.passwordHash) return { ok: false, reason: "no_password_set" };
  const ok = await verifyPassword(oldPw, user.passwordHash);
  if (!ok) return { ok: false, reason: "invalid_credentials" };
  const passwordHash = await hashPassword(newPw);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  return { ok: true };
}

export async function setPasswordFirstTime(pw: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const me = await requireOwnAccount();
  if (!me.ok) return me;
  const userId = me.userId;
  if (pw.length < 8) return { ok: false, reason: "password_too_short" };
  if (pw.length > 200) return { ok: false, reason: "password_too_long" };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (user?.passwordHash) return { ok: false, reason: "password_already_set" };
  const passwordHash = await hashPassword(pw);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.account.upsert({
      where: { provider_providerAccountId: { provider: "credentials", providerAccountId: userId } },
      create: { userId, type: "credentials", provider: "credentials", providerAccountId: userId },
      update: {},
    }),
  ]);
  return { ok: true };
}

/**
 * Снять аватар. Файл **под нашим корнем** стираем, чужой адрес (снимок из
 * Google или GitHub) стирать нечего — он не наш.
 */
export async function removeAvatar(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const me = await requireOwnAccount();
  if (!me.ok) return me;
  const row = await prisma.user.findUnique({
    where: { id: me.userId },
    select: { image: true },
  });
  const path = avatarFilePath(row?.image ?? null, me.userId);
  await prisma.user.update({ where: { id: me.userId }, data: { image: null } });
  if (path) await unlink(path).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Выйти на всех остальных устройствах. Свой сеанс остаётся жить: нажатие не
 * должно выбрасывать нажавшего — он как раз и хочет остаться один.
 *
 * То же, что делает сброс пароля (слайс 4а), но нажатое сознательно и без смены
 * пароля: «я входил с чужого ноутбука».
 */
export async function signOutOtherSessions(): Promise<
  { ok: true; closed: number } | { ok: false; reason: string }
> {
  const me = await requireOwnAccount();
  if (!me.ok) return me;
  const jar = await cookies();
  const token = jar.get(authSessionCookieName())?.value ?? null;
  const r = await prisma.session.deleteMany({
    where: { userId: me.userId, ...(token ? { NOT: { sessionToken: token } } : {}) },
  });
  revalidatePath("/", "layout");
  return { ok: true, closed: r.count };
}
