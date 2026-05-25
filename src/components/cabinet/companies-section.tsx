import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listViewerCompanies } from "@/lib/business";
import { CreateCompanyForm } from "@/components/cabinet/create-company-form";

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
              <Link href={`/${locale}/cabinet/companies/${c.id}`} className="block">
                <div className="font-medium">{c.displayName}</div>
                <div className="text-xs text-muted">{c.legalName}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <CreateCompanyForm />
    </section>
  );
}
