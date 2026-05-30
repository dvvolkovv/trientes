import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { sanitizeFintechSocials } from "@/lib/fintech";
import { safeHttpUrl } from "@/lib/crypto-map";

export const dynamic = "force-dynamic";

export default async function FintechDetail({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("fintech");

  const row = await prisma.fintechCompany.findUnique({ where: { slug } });
  if (!row || row.status !== "APPROVED") notFound();

  const socials = sanitizeFintechSocials(row.socials);
  const website = safeHttpUrl(row.website);

  return (
    <main className="bg-bg">
      <div className="max-w-[1200px] mx-auto px-4 md:px-12 xl:px-20 py-12">
        <header className="flex flex-col md:flex-row items-start gap-6 mb-10">
          {row.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.logoUrl} alt="" className="h-24 w-24 rounded-2xl object-cover bg-card border border-hairline" />
          ) : (
            <div className="h-24 w-24 rounded-2xl bg-card border border-hairline" />
          )}
          <div className="flex-1 min-w-0">
            <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">{t("breadcrumb")}</div>
            <h1 className="text-[36px] md:text-[48px] font-bold tracking-[-0.03em]">{row.displayName}</h1>
            {row.legalName ? <p className="text-muted text-sm mt-1">{row.legalName}</p> : null}
            {website ? (
              <a href={website} target="_blank" rel="noopener noreferrer"
                className="inline-block mt-3 text-accent hover:underline text-sm">
                {website.replace(/^https?:\/\//, "")}
              </a>
            ) : null}
          </div>
        </header>

        {row.description ? (
          <section className="mb-10">
            <p className="text-[16px] leading-[1.6] text-foreground/90 whitespace-pre-line">{row.description}</p>
          </section>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Section title={t("sections.services")}>
            <div className="flex flex-wrap gap-2">
              {row.services.map((s) => (
                <span key={s} className="rounded-md bg-card px-2 py-1 text-[12px] border border-hairline">
                  {t(`services.${s}`)}
                </span>
              ))}
            </div>
          </Section>

          {row.kycLevel ? (
            <Section title={t("sections.kyc")}>
              <p className="text-sm">{t(`kyc.${row.kycLevel}`)}</p>
            </Section>
          ) : null}

          {row.availableIn.length > 0 ? (
            <Section title={t("sections.availableIn")}>
              <div className="flex flex-wrap gap-1.5">
                {row.availableIn.map((cc) => (
                  <span key={cc} className="num text-[11px] uppercase tracking-wider bg-card px-2 py-1 rounded border border-hairline">{cc}</span>
                ))}
              </div>
            </Section>
          ) : null}

          {row.supportedFiats.length > 0 ? (
            <Section title={t("sections.fiats")}>
              <p className="text-sm">{row.supportedFiats.join(" · ")}</p>
            </Section>
          ) : null}

          {row.supportedCoinIds.length > 0 ? (
            <Section title={t("sections.coins")}>
              <p className="text-sm capitalize">{row.supportedCoinIds.join(", ")}</p>
            </Section>
          ) : null}

          {(row.countryCode || row.city || row.address) ? (
            <Section title={t("sections.hq")}>
              <p className="text-sm">
                {[row.address, row.city, row.countryCode].filter(Boolean).join(", ")}
              </p>
            </Section>
          ) : null}

          {row.feesSummary ? (
            <Section title={t("sections.fees")}>
              <p className="text-sm whitespace-pre-line">{row.feesSummary}</p>
            </Section>
          ) : null}

          {(row.appStoreUrl || row.playStoreUrl) ? (
            <Section title={t("sections.apps")}>
              <div className="flex gap-3">
                {row.appStoreUrl ? <a href={safeHttpUrl(row.appStoreUrl) ?? "#"} target="_blank" rel="noopener noreferrer" className="text-accent text-sm hover:underline">App Store</a> : null}
                {row.playStoreUrl ? <a href={safeHttpUrl(row.playStoreUrl) ?? "#"} target="_blank" rel="noopener noreferrer" className="text-accent text-sm hover:underline">Play Store</a> : null}
              </div>
            </Section>
          ) : null}

          {socials.length > 0 ? (
            <Section title={t("sections.socials")}>
              <div className="flex flex-wrap gap-3">
                {socials.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent text-sm hover:underline">
                    {s.network}
                  </a>
                ))}
              </div>
            </Section>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-hairline rounded-2xl p-5">
      <h2 className="num text-[11px] uppercase tracking-[0.25em] text-muted mb-3">{title}</h2>
      {children}
    </section>
  );
}
