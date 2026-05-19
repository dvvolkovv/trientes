import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HomeContent />;
}

function HomeContent() {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  return (
    <main className="container mx-auto px-4 py-12">
      <h1 className="text-4xl font-bold">{tc("appName")}</h1>
      <p className="text-muted-foreground mt-2">{tc("tagline")}</p>
      <div className="mt-12">
        <h2 className="text-2xl font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground mt-2">{t("comingSoon")}</p>
      </div>
    </main>
  );
}
