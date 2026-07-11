import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";

export default async function NotFound() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "exchangeCard.notFound" });
  return (
    <main className="max-w-2xl mx-auto px-5 py-16 text-center">
      <h1 className="text-[24px] font-semibold mb-4">{t("title")}</h1>
      <Link href={`/${locale}/exchanges`} className="text-accent hover:underline">{t("back")}</Link>
    </main>
  );
}
