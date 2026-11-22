import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { readSectionColors, type SectionColorMap } from "@/lib/section-colors";

/**
 * Цвета разделов текущего человека — и для полосы админки, и для плиток
 * кабинета. Настройка личная: смысл цвета — память этого человека, а общий на
 * всех цвет назначал бы владелец, и это было бы оформление платформы, а не
 * узнавание кнопки.
 *
 * Не вошедший получает пустой словарь, а не отказ: полоса и плитки обязаны
 * отрисоваться и без настройки.
 */
export async function readViewerSectionColors(): Promise<SectionColorMap> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return {};
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { sectionColors: true },
  });
  return readSectionColors(row?.sectionColors);
}
