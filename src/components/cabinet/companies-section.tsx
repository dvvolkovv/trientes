import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listViewerCompanies } from "@/lib/business";
import { CreateCompanyForm } from "@/components/cabinet/create-company-form";

const STATUS_CLASS: Record<string, string> = {
  PENDING: "bg-yellow-500/15 text-yellow-500",
  APPROVED: "bg-green-500/15 text-green-500",
  REJECTED: "bg-red-500/15 text-red-500",
};

export async function CompaniesSection({ locale }: { locale: string }) {
  const { companies } = await listViewerCompanies();
  const t = await getTranslations("cabinet.companies");
  return (
    <section id="companies" className="space-y-6">
      <h2 className="text-[24px] font-bold tracking-[-0.02em]">{t("title")}</h2>
      {companies.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {companies.map((c) => (
            <li key={c.id} className="border border-hairline rounded-md p-4 hover:bg-card-alt">
              <Link
                href={`/${locale}/cabinet/companies/${c.id}`}
                className="flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{c.displayName}</div>
                  <div className="text-xs text-muted truncate">{c.legalName}</div>
                  {c.status === "REJECTED" && c.rejectionReason && (
                    <div className="text-xs text-red-400 mt-1">{c.rejectionReason}</div>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${STATUS_CLASS[c.status] ?? ""}`}>
                  {t(`status.${c.status}`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <CreateCompanyForm />
    </section>
  );
}
