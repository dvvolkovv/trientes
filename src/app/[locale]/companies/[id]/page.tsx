import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const SITE = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const row = await prisma.company.findUnique({
    where: { id },
    select: { displayName: true, legalName: true, description: true, logoUrl: true, country: true, city: true, status: true, kybStatus: true },
  });
  if (!row || row.status !== "APPROVED") return {};
  const verifiedPrefix = row.kybStatus === "APPROVED" ? "✓ " : "";
  const title = `${verifiedPrefix}${row.displayName} — crypto-friendly business`;
  const location = [row.city, row.country].filter(Boolean).join(", ");
  const description = row.description?.slice(0, 200)
    ?? `${row.displayName}${location ? ` (${location})` : ""} accepts crypto. Verified profile on Trientes.`;
  const canonical = `${SITE}/${locale}/companies/${id}`;
  return {
    title, description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublicCompanyPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      points: {
        where: { status: "APPROVED" },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true, type: true, name: true, address: true, lat: true, lon: true,
          city: true, countryCode: true, openingHours: true, website: true,
        },
      },
    },
  });
  if (!company || company.status !== "APPROVED") notFound();

  const t = await getTranslations("companyPublic");
  const tk = await getTranslations("business.kyb");
  const onlinePoints = company.points.filter((p) => p.type === "ONLINE");
  const physicalPoints = company.points.filter((p) => p.type !== "ONLINE");

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Companies", item: `${SITE}/${locale}/companies` },
      { "@type": "ListItem", position: 2, name: company.displayName, item: `${SITE}/${locale}/companies/${id}` },
    ],
  };
  const orgLd = company.kybStatus === "APPROVED" ? {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: company.displayName,
    legalName: company.legalName,
    url: `${SITE}/${locale}/companies/${id}`,
    logo: company.logoUrl ?? undefined,
    description: company.description ?? undefined,
    address: company.address ? { "@type": "PostalAddress", streetAddress: company.address } : undefined,
  } : null;

  return (
    <main className="max-w-[860px] mx-auto px-4 md:px-12 py-12 space-y-10">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      {orgLd ? (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgLd) }}
        />
      ) : null}
      <header className="flex items-start gap-4 flex-wrap">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logoUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
        ) : (
          <div className="h-16 w-16 rounded-xl bg-bg-tint" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h1 className="text-[32px] md:text-[40px] font-bold tracking-[-0.03em]">
              {company.displayName}
            </h1>
            {company.kybStatus === "APPROVED" ? (
              <span
                title={tk("status.APPROVED")}
                className="inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1 rounded-full bg-green-500/15 text-green-500"
              >
                ✓ {t("verified")}
              </span>
            ) : null}
          </div>
          <p className="text-muted">{company.legalName}</p>
          {company.country || company.city ? (
            <p className="text-sm text-muted mt-1">
              {[company.city, company.country].filter(Boolean).join(", ")}
            </p>
          ) : null}
        </div>
      </header>

      {company.description ? (
        <section>
          <p className="whitespace-pre-wrap text-sm md:text-base">{company.description}</p>
        </section>
      ) : null}

      <section className="grid sm:grid-cols-2 gap-3 text-sm">
        {company.website ? (
          <Field label={t("website")}>
            <a href={company.website} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline">
              {company.website.replace(/^https?:\/\//, "")}
            </a>
          </Field>
        ) : null}
        {company.email ? (
          <Field label={t("email")}>
            <a href={`mailto:${company.email}`} className="text-accent underline">{company.email}</a>
          </Field>
        ) : null}
        {company.phone ? <Field label={t("phone")}><span>{company.phone}</span></Field> : null}
        {company.address ? <Field label={t("address")}><span>{company.address}</span></Field> : null}
      </section>

      {physicalPoints.length > 0 ? (
        <section>
          <h2 className="text-[20px] font-semibold mb-3">{t("placesTitle")}</h2>
          <ul className="space-y-2">
            {physicalPoints.map((p) => (
              <li key={p.id} className="border border-hairline rounded-md px-3 py-2.5">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted">{p.address ?? "—"}</div>
                <div className="text-[11px] text-muted mt-1 flex flex-wrap gap-x-3">
                  <span>{t(`pointType.${p.type}`)}</span>
                  {p.openingHours ? <span>{p.openingHours}</span> : null}
                  {p.lat !== null && p.lon !== null ? (
                    <Link href={`/${locale}/coin/bitcoin`} className="text-accent underline">
                      {t("openOnMap")} →
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {onlinePoints.length > 0 ? (
        <section>
          <h2 className="text-[20px] font-semibold mb-3">{t("onlineTitle")}</h2>
          <ul className="space-y-2">
            {onlinePoints.map((p) => (
              <li key={p.id} className="border border-hairline rounded-md px-3 py-2.5">
                <div className="font-medium">{p.name}</div>
                {p.website ? (
                  <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-accent underline">
                    {p.website.replace(/^https?:\/\//, "")}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted mb-0.5">{label}</div>
      {children}
    </div>
  );
}
