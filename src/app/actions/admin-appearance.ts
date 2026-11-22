"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isSectionColorKey, isSectionKey, readSectionColors } from "@/lib/section-colors";

/**
 * Цвет контура раздела для себя — в админке и в кабинете.
 *
 * Права на это действие не заводим, и калитка здесь — просто «вошёл». Пока
 * цвета были только у админки, калиткой стоял `checkAdmin`; теперь это личный
 * вид своего кабинета, и отдельное право означало бы, что владелец может
 * запретить человеку выбрать себе цвет.
 *
 * Оба конца проверяются на запись: неизвестный раздел или цвет вне палитры
 * отвергаются вслух, а не пишутся молча.
 */
async function viewerId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function setSectionColor(input: { section: string; color: string | null }) {
  const userId = await viewerId();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  if (!isSectionKey(input.section)) {
    return { ok: false as const, reason: "section_invalid" as const };
  }
  if (input.color !== null && !isSectionColorKey(input.color)) {
    return { ok: false as const, reason: "color_invalid" as const };
  }

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { sectionColors: true },
  });
  const colors = readSectionColors(row?.sectionColors);
  if (input.color === null) delete colors[input.section];
  else colors[input.section] = input.color;

  await prisma.user.update({ where: { id: userId }, data: { sectionColors: colors } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Сбросить все цвета разом. */
export async function resetSectionColors() {
  const userId = await viewerId();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  await prisma.user.update({ where: { id: userId }, data: { sectionColors: {} } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
