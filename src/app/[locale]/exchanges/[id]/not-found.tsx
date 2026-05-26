import { getTranslations } from "next-intl/server";
import Link from "next/link";

export default async function NotFound({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "exchangeCard.notFound" });
  return (
    <main className="max-w-2xl mx-auto px-5 py-16 text-center">
      <h1 className="text-[24px] font-semibold mb-4">{t("title")}</h1>
      <Link href={`/${locale}/exchanges`} className="text-accent hover:underline">{t("back")}</Link>
    </main>
  );
}
