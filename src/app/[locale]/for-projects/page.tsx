import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { claimInboxAddress } from "@/lib/claims/mailbox";
import { SUPPORTED_LOCALES } from "@/lib/locales";

export const dynamic = "force-dynamic";

const SITE = "https://trientes.org";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "forProjects" });
  return {
    title: { absolute: `${t("title")} · Trientes` },
    description: t("subtitle"),
    alternates: {
      canonical: `${SITE}/${locale}/for-projects`,
      languages: Object.fromEntries(
        SUPPORTED_LOCALES.map((l) => [l, `${SITE}/${l}/for-projects`]),
      ),
    },
  };
}

/**
 * «Для проектов» — страница, на которую ведёт приветственное письмо и кнопка
 * «это наш проект» с карточки (слайс CI).
 *
 * Она говорит ровно три вещи: что мы читаем сами, что проект может добавить и
 * как доказать права письмом. Обещаний приёма чужого API здесь нет: адрес
 * фида принимает человек, а соединяют его наши специалисты — обещать API,
 * которого нет, нельзя.
 */
export default async function ForProjectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ domain?: string }>;
}) {
  const { locale } = await params;
  const { domain } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("forProjects");
  const inbox = claimInboxAddress();
  const asked = typeof domain === "string" && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)
    ? domain.toLowerCase()
    : null;

  const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="rounded-[20px] border border-hairline bg-card p-5 md:p-7">
      <h2 className="mb-2 text-[18px] font-bold tracking-[-0.02em]">{title}</h2>
      <div className="text-[13.5px] leading-relaxed text-muted">{children}</div>
    </section>
  );

  return (
    <main className="mx-auto max-w-[760px] px-5 py-10 md:px-8 md:py-16">
      <div className="num mb-3 text-[11px] uppercase tracking-[0.3em] text-accent">
        ● {t("kicker")}
      </div>
      <h1 className="mb-3 text-[34px] font-bold leading-[1.05] tracking-[-0.03em] md:text-[52px]">
        {t("title")}
      </h1>
      <p className="mb-8 text-[15px] leading-relaxed text-muted">{t("subtitle")}</p>

      <div className="flex flex-col gap-4">
        {inbox ? (
          <Card title={t("claim.title")}>
            <p className="mb-3">
              {asked ? t("claim.bodyDomain", { domain: asked }) : t("claim.body")}
            </p>
            <p className="mb-3">
              <a href={`mailto:${inbox}`} className="font-mono text-[14px] text-accent underline">
                {inbox}
              </a>
            </p>
            <ul className="mb-3 flex list-disc flex-col gap-1 pl-5">
              <li>{t("claim.rule1")}</li>
              <li>{t("claim.rule2")}</li>
              <li>{t("claim.rule3")}</li>
            </ul>
            <p>{t("claim.after")}</p>
          </Card>
        ) : null}

        <Card title={t("weRead.title")}>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>{t("weRead.prices")}</li>
            <li>{t("weRead.chain")}</li>
            <li>{t("weRead.fee")}</li>
          </ul>
          <p className="mt-3">{t("weRead.note")}</p>
        </Card>

        <Card title={t("youAdd.title")}>
          <p>{t("youAdd.body")}</p>
        </Card>

        <Card title={t("api.title")}>
          <p className="mb-3">{t("api.body")}</p>
          <p>{t("api.honest")}</p>
        </Card>

        <Card title={t("other.title")}>
          <p className="mb-3">{t("other.body")}</p>
          <div className="flex flex-wrap gap-3">
            <Link href={`/${locale}/request`} className="text-[13.5px] font-semibold text-accent">
              {t("other.request")}
            </Link>
            <Link href={`/${locale}/business`} className="text-[13.5px] font-semibold text-accent">
              {t("other.business")}
            </Link>
          </div>
        </Card>
      </div>
    </main>
  );
}
