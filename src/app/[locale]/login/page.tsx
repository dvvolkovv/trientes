import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { LoginButtons } from "@/components/login-buttons";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("common");
  return (
    <main className="container mx-auto max-w-md px-4 py-16">
      <h1 className="text-3xl font-bold mb-8">{t("signIn")}</h1>
      <LoginButtons />
    </main>
  );
}
