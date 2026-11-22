import { getTranslations } from "next-intl/server";
import { CabinetBackLink } from "@/components/cabinet/back-link";

/**
 * Возврат в кабинет — кнопка сверху **каждой** страницы, открытой из кабинета:
 * и разделов предприятия, и своих заявок, монет, бирж и переписки с магазинами.
 *
 * Прежде вверх вела только мелкая подчёркнутая строка на соседний уровень
 * («← Название», «Предприятие / Склады»), а кое-где не вела ничего — владелец
 * сказал: «где-то есть, где-то нет». Хлебные крошки оставлены на месте: они
 * ведут на шаг назад, а эта кнопка — домой.
 *
 * Подпись читает сама (`cabinet.hub.back`): у разделов разные области перевода,
 * и тащить через каждую страницу ещё один параметр значило бы однажды его забыть.
 */
export async function CabinetBackButton({ locale }: { locale: string }) {
  const t = await getTranslations("cabinet.hub");
  return <CabinetBackLink href={`/${locale}/cabinet`} label={t("back")} />;
}
