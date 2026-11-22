import { permanentRedirect } from "next/navigation";

/** Второй фактор переехал в раздел «Безопасность» профиля (слайс BT). */
export default async function CabinetMfaPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/cabinet/profile#security`);
}
