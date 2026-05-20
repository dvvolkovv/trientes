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
    <main className="max-w-2xl mx-auto px-6 py-10 md:py-16 space-y-12">
      <header>
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">
          Section · Request
        </div>
        <h1 className="text-[28px] sm:text-[36px] md:text-[48px] font-bold tracking-[-0.035em]">
          {t("title")}
        </h1>
        <p className="text-muted mt-3 max-w-[640px]">{t("subtitle")}</p>
      </header>

      <section>
        <div className="num text-[11px] uppercase tracking-[0.18em] text-muted mb-2">
          New request
        </div>
        <h2 className="text-[20px] md:text-[24px] font-bold tracking-[-0.02em] mb-4">
          {t("newRequest")}
        </h2>
        <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
          <CoinRequestForm />
        </div>
      </section>

      <section>
        <div className="num text-[11px] uppercase tracking-[0.18em] text-muted mb-2">
          History
        </div>
        <h2 className="text-[20px] md:text-[24px] font-bold tracking-[-0.02em] mb-4">
          {t("yourRequests")}
        </h2>
        <CoinRequestList />
      </section>
    </main>
  );
}
