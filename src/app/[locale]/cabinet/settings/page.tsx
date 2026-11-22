import { permanentRedirect } from "next/navigation";

/**
 * Настройки переехали в профиль (слайс BT). Адрес остаётся живым: ссылки на него
 * разбросаны по письмам и чужим закладкам — тот же приём, которым `/settings`
 * продолжает работать с слайса 4а.
 */
export default async function CabinetSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/cabinet/profile#settings`);
}
