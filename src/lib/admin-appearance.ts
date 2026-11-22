import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { readSectionColors, type SectionColorMap } from "@/lib/admin-sections";

/**
 * Цвета разделов текущего оператора. Настройка личная: смысл цвета — память
 * этого человека, а общий на всех цвет назначал бы владелец, и это было бы
 * оформление платформы, а не узнавание кнопки.
 *
 * Не вошедший получает пустой словарь, а не отказ: полоса обязана отрисоваться
 * и без настройки.
 */
export async function readViewerSectionColors(): Promise<SectionColorMap> {
  const admin = await checkAdmin();
  if (!admin.ok) return {};
  const row = await prisma.user.findUnique({
    where: { id: admin.userId },
    select: { adminSectionColors: true },
  });
  return readSectionColors(row?.adminSectionColors);
}
