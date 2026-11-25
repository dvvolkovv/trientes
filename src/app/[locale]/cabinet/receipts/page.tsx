import Link from "next/link";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireCabinetUser } from "@/lib/cabinet/viewer";
import { readBuyerReceipts } from "@/lib/sales/read";
import { CabinetBackButton } from "@/components/cabinet/back-button";

export const dynamic = "force-dynamic";

/** Свои чеки покупателя — те, что он сам привязал, перейдя по ссылке продавца. */
export default async function MyReceiptsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("receipt");
  const viewer = await requireCabinetUser(locale);
  if (!viewer) redirect(`/${locale}/login`);

  const rows = await readBuyerReceipts(viewer.id);

  return (
    <main className="mx-auto w-full max-w-[640px] overflow-x-clip px-4 py-8 md:px-6">
      <div className="mb-4">
        <CabinetBackButton locale={locale} />
      </div>
      <header className="mb-5">
        <h1 className="text-[26px] font-bold tracking-[-0.02em]">{t("myTitle")}</h1>
        <p className="mt-1 text-[13px] leading-snug text-muted">{t("mySubtitle")}</p>
      </header>

      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">{t("myEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/${locale}/cabinet/receipts/${r.id}`}
                className="flex min-h-14 items-center gap-3 rounded-[12px] border border-hairline bg-card px-3 hover:border-accent"
              >
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{r.sellerName}</span>
                <span className="block text-[11.5px] text-muted">
                  {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(r.createdAt)}
                  {" · "}
                  {t("number", { number: r.number })}
                  {r.status === "CANCELLED" ? ` · ${t("cancelled")}` : ""}
                </span>
              </div>
              <span className="shrink-0 text-[13px] num">
                {new Intl.NumberFormat(locale, { style: "currency", currency: r.currency }).format(r.total)}
              </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
