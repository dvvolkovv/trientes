import { redirect } from "next/navigation";

export default async function BusinessLegacyRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/cabinet#companies`);
}
