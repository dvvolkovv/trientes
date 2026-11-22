import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ensureUsername } from "@/lib/ensure-username";
import { loadMfaGate } from "@/lib/authz/guard";

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

  // Заведённый второй фактор спрашивается на входе в кабинет — там, где меняют
  // пароль, почту и имя входа (слайс BT). Сотрудника отправляет заводить фактор
  // своя калитка админки; посетителя, который фактор не заводил, калитка
  // пропускает молча.
  const gate = await loadMfaGate();
  if (gate === "verify") {
    redirect(`/${locale}/mfa?next=${encodeURIComponent(`/${locale}${backTo}`)}`);
  }

  let user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect(`/${locale}/login`);
  if (!user.username) {
    await ensureUsername(userId);
    user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) redirect(`/${locale}/login`);
  }
  return user;
}
