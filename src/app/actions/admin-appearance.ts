"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import {
  isAdminSectionKey,
  isSectionColorKey,
  readSectionColors,
} from "@/lib/admin-sections";

/**
 * Цвет контура раздела для себя.
 *
 * Права на это действие не заводим: это личная настройка вида, и сотрудник,
 * допущенный в админку, вправе выбрать себе цвета — отдельное право означало
 * бы, что владелец может запретить человеку выбрать цвет. Калитка всё та же
 * `checkAdmin`, то есть настроить может только тот, кто внутри.
 *
 * Оба конца проверяются на запись: неизвестный раздел или цвет вне палитры
 * отвергаются вслух, а не пишутся молча.
 */
export async function setSectionColor(input: { section: string; color: string | null }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false as const, reason: admin.reason };
  if (!isAdminSectionKey(input.section)) {
    return { ok: false as const, reason: "section_invalid" as const };
  }
  if (input.color !== null && !isSectionColorKey(input.color)) {
    return { ok: false as const, reason: "color_invalid" as const };
  }

  const row = await prisma.user.findUnique({
    where: { id: admin.userId },
    select: { adminSectionColors: true },
  });
  const colors = readSectionColors(row?.adminSectionColors);
  if (input.color === null) delete colors[input.section];
  else colors[input.section] = input.color;

  await prisma.user.update({
    where: { id: admin.userId },
    data: { adminSectionColors: colors },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Сбросить все цвета разом. */
export async function resetSectionColors() {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false as const, reason: admin.reason };
  await prisma.user.update({
    where: { id: admin.userId },
    data: { adminSectionColors: {} },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
