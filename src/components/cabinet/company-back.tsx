import { getTranslations } from "next-intl/server";
import { CabinetBackLink } from "@/components/cabinet/back-link";

/**
 * Возврат в кабинет — кнопка сверху **каждого** раздела кабинета предприятия.
 *
 * Прежде из предприятия вверх вела только мелкая подчёркнутая строка на
 * соседний уровень («← Название», «Предприятие / Склады»), а из самой карточки
 * предприятия — ничего: владелец сказал, что «этой кнопочки вверху нету».
 * Хлебные крошки оставлены на месте: они ведут на шаг назад, а эта кнопка — домой.
 *
 * Подпись читает сама (`cabinet.hub.back`): у разделов разные области перевода,
 * и тащить через каждую страницу ещё один параметр значило бы однажды его забыть.
 */
export async function CabinetBackButton({ locale }: { locale: string }) {
  const t = await getTranslations("cabinet.hub");
  return <CabinetBackLink href={`/${locale}/cabinet`} label={t("back")} />;
}
