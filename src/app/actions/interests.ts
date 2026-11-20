"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { INTEREST_KEYS, parseAlert, parseCorridor, type InterestKey } from "@/lib/interests";

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

function isKey(raw: unknown): raw is InterestKey {
  return typeof raw === "string" && (INTEREST_KEYS as readonly string[]).includes(raw);
}

/**
 * Три состояния одной строки: нравится, молчу, не нравится. «Молчу» — это **снятие**
 * строки, а не третье значение в базе: отсутствие отметки и значит, что человек об
 * этом интересе ничего не сказал (`activeInterests`).
 */
export async function setInterest(key: unknown, verdict: unknown) {
  const userId = await requireUserId();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  if (!isKey(key)) return { ok: false as const, reason: "invalid" as const };
  if (verdict === null || verdict === "NONE") {
    await prisma.userInterest.deleteMany({ where: { userId, key } });
    revalidatePath("/", "layout");
    return { ok: true as const };
  }
  if (verdict !== "LIKE" && verdict !== "DISLIKE") {
    return { ok: false as const, reason: "invalid" as const };
  }
  await prisma.userInterest.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, verdict },
    update: { verdict },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Коридор и подсказка — два числа человека; пустое поле возвращает умолчание. */
export async function saveRouteRadii(input: { corridor?: unknown; alert?: unknown }) {
  const userId = await requireUserId();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const corridor = parseCorridor(typeof input.corridor === "string" ? input.corridor : "");
  if (!corridor.ok) return { ok: false as const, reason: corridor.reason };
  const alert = parseAlert(typeof input.alert === "string" ? input.alert : "");
  if (!alert.ok) return { ok: false as const, reason: alert.reason };
  await prisma.user.update({
    where: { id: userId },
    data: { routeCorridorMeters: corridor.value, routeAlertMeters: alert.value },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
