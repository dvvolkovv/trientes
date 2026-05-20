"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CURRENCIES, type Currency } from "@/lib/currency";
import { CURRENCY_COOKIE } from "@/lib/get-currency";

export async function setCurrency(value: string) {
  if (!(CURRENCIES as readonly string[]).includes(value)) return { ok: false };
  const currency = value as Currency;

  // Always set cookie (works for guests + logged-in)
  const jar = await cookies();
  jar.set(CURRENCY_COOKIE, currency, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  // If logged in, also persist on user
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (userId) {
    await prisma.user.update({
      where: { id: userId },
      data: { preferredCurrency: currency },
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
