import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CURRENCIES, type Currency } from "@/lib/currency";

const COOKIE = "trientes_currency";

function isValid(v: string | undefined | null): v is Currency {
  return !!v && (CURRENCIES as readonly string[]).includes(v);
}

export async function getCurrency(): Promise<Currency> {
  // Logged-in: use user preference if valid
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferredCurrency: true },
    });
    if (u && isValid(u.preferredCurrency)) return u.preferredCurrency;
  }
  // Guest: cookie
  const c = (await cookies()).get(COOKIE)?.value;
  if (isValid(c)) return c;
  return "USD";
}

export const CURRENCY_COOKIE = COOKIE;
