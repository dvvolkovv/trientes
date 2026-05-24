import { redirect } from "next/navigation";

export default async function SettingsRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/cabinet#settings`);
}
