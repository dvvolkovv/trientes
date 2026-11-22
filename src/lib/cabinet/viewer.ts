import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ensureUsername } from "@/lib/ensure-username";

/**
 * Вошедший хозяин кабинета. Один загрузчик на хаб и на все разделы: своя копия
 * этих восьми строк в каждом из двенадцати файлов разошлась бы при первой же
 * правке (имя входа доводится лениво — `ensureUsername`).
 *
 * Не вошедший уходит на вход с возвратом ровно на ту страницу, куда шёл, а не
 * в хаб: человек нажал ссылку на свои заявки, туда его и надо вернуть.
 */
export async function requireCabinetUser(locale: string, backTo = "/cabinet") {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}${backTo}`)}`);

  let user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect(`/${locale}/login`);
  if (!user.username) {
    await ensureUsername(userId);
    user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) redirect(`/${locale}/login`);
  }
  return user;
}
