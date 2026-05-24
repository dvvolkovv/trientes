"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { hashPassword, verifyPassword } from "@/lib/password";
import { validateUsername } from "@/lib/username";
import { validateProfileInput, type ProfileInput } from "@/lib/profile";

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function setUsername(next: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, reason: "unauth" };
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
  const userId = await requireUserId();
  if (!userId) return { ok: false, reason: "unauth" };
  const v = validateProfileInput(input);
  if (!v.ok) return { ok: false, reason: v.reason };
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const emailChanged = (current?.email ?? null) !== v.data.email;
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
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function changePassword(oldPw: string, newPw: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, reason: "unauth" };
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
  const userId = await requireUserId();
  if (!userId) return { ok: false, reason: "unauth" };
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
