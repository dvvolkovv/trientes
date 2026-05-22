"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { SUPPORTED_LOCALES } from "@/lib/locales";

const ALLOWED_CURRENCIES = ["USD", "EUR", "RUB", "GBP", "JPY", "CNY", "BTC", "ETH", "DASH"];
const ALLOWED_THEMES = ["light", "dark", "system"];

export async function updatePreferences(input: {
  locale?: string;
  currency?: string;
  theme?: string;
}) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" as const };

  const data: { preferredLocale?: string; preferredCurrency?: string; preferredTheme?: string } = {};
  if (input.locale && SUPPORTED_LOCALES.includes(input.locale as typeof SUPPORTED_LOCALES[number]))
    data.preferredLocale = input.locale;
  if (input.currency && ALLOWED_CURRENCIES.includes(input.currency))
    data.preferredCurrency = input.currency;
  if (input.theme && ALLOWED_THEMES.includes(input.theme))
    data.preferredTheme = input.theme;
  if (Object.keys(data).length === 0) return { ok: false, reason: "no_change" as const };
  await prisma.user.update({ where: { id: userId }, data });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
