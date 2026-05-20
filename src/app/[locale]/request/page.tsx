import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { isAuthenticated } from "@/lib/watchlist";
import { CoinRequestForm } from "@/components/coin-request-form";
import { CoinRequestList } from "@/components/coin-request-list";

export const dynamic = "force-dynamic";

export default async function RequestPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const isAuthed = await isAuthenticated();
  if (!isAuthed) redirect(`/${locale}/login`);

  const t = await getTranslations("request");
  return (
    <main className="container mx-auto px-4 py-8 max-w-2xl space-y-10">
      <header>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
      </header>
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("newRequest")}</h2>
        <CoinRequestForm />
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("yourRequests")}</h2>
        <CoinRequestList />
      </section>
    </main>
  );
}
