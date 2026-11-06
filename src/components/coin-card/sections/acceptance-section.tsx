import { getLocale, getTranslations } from "next-intl/server";
import { getAcceptanceSummary } from "@/lib/coin-card-acceptance";
import {
  addPointHref,
  ctaHref,
  manageHref,
  newCompanyHref,
  type CtaContext,
  type MerchantCta,
} from "@/lib/coin-card-merchant-cta";
import { getMerchantCta } from "@/lib/coin-card-merchant-viewer";
import { countryName } from "@/lib/countries";
import { ProvenanceBadge } from "../provenance-badge";

const SITE = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

/**
 * Главный факт карточки для продавца: принимают ли эту монету живьём.
 * Ноль — это ноль: блок не скрывается, а честно говорит «пока нигде» и
 * предлагает стать первым. Скрытый пустой блок читается как обман, когда
 * пользователь найдёт его у другой монеты.
 */
export async function AcceptanceSection({
  cardId,
  slug,
  symbol,
}: {
  cardId: string;
  slug: string;
  symbol: string;
}) {
  const [t, tb, ts, locale] = await Promise.all([
    getTranslations("coinCard.acceptance"),
    getTranslations("business"),
    getTranslations("coinCard.sections"),
    getLocale(),
  ]);
  const [summary, cta] = await Promise.all([
    getAcceptanceSummary(cardId),
    getMerchantCta(cardId),
  ]);

  const ctx = { locale, slug, cardId };
  // Система не выбирает компанию за человека: при любом числе компаний он видит
  // список и решает сам. Один вариант остаётся только когда компаний нет вовсе.
  const simpleHref = cta.kind === "choose" ? null : ctaHref(cta, ctx);
  const simpleLabel =
    cta.kind === "login" ? t("loginToAccept")
    : cta.kind === "register_company" ? (summary.total === 0 ? t("becomeFirst") : t("registerCompany"))
    : null;

  const mapHref = `/${locale}/crypto-map?coin=${encodeURIComponent(`card:${cardId}`)}`;
  const badgeAlt = t("badgeAlt", { symbol: symbol.toUpperCase() });
  const snippet =
    `<a href="${SITE}/${locale}/coin/${slug}"><img src="${SITE}/${locale}/coin/${slug}/badge.svg" alt="${badgeAlt}"></a>`;

  const chip = "inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md border border-hairline text-muted";
  const label = "text-[12px] uppercase tracking-[0.15em] text-muted";

  return (
    <section id="acceptance" className="scroll-mt-24">
      <div className="num text-[11px] uppercase tracking-[0.3em] text-accent mb-2">{t("eyebrow")}</div>
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">
        {ts("acceptance")}
      </h2>

      {summary.total === 0 ? (
        <div className="border border-hairline rounded-md p-5 space-y-3">
          <p className="text-[15px]">{t("zero")}</p>
          <p className="text-muted text-[13px] max-w-[620px]">{t("zeroHint")}</p>
          <MerchantActions cta={cta} ctx={ctx} t={t} simpleHref={simpleHref} simpleLabel={simpleLabel} primary />
        </div>
      ) : (
        <div className="border border-hairline rounded-md p-5 space-y-5">
          <div className="flex flex-wrap gap-8">
            <div>
              <div className={label}>
                {t("points")}
                <ProvenanceBadge
                  entry={{ kind: "AGGREGATED", source: t("source"), at: new Date().toISOString() }}
                />
              </div>
              <div className="num text-[28px] font-bold">{summary.total}</div>
            </div>
            <div>
              <div className={label}>{t("countries")}</div>
              <div className="num text-[28px] font-bold">{summary.countries}</div>
            </div>
          </div>

          <div className="space-y-2">
            <div className={label}>{t("byType")}</div>
            <div className="flex flex-wrap gap-2">
              {summary.byType.map((b) => (
                <span key={b.type} className={chip}>
                  {tb(`type.${b.type}`)} <span className="num text-foreground">{b.count}</span>
                </span>
              ))}
            </div>
          </div>

          {summary.byCountry.length > 0 && (
            <div className="space-y-2">
              <div className={label}>{t("topCountries")}</div>
              <div className="flex flex-wrap gap-2">
                {summary.byCountry.map((c) => (
                  <span key={c.code} className={chip}>
                    {countryName(c.code) ?? c.code} <span className="num text-foreground">{c.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className={label}>{t("nearby")}</div>
            <ul className="border-y border-hairline">
              {summary.recent.map((p) => (
                <li key={p.id} className="border-b border-hairline last:border-0">
                  <a href={mapHref} className="flex items-baseline justify-between gap-4 py-2.5 hover:text-accent">
                    <span className="text-[14px]">{p.name}</span>
                    <span className="text-[12px] text-muted shrink-0">
                      {[p.city, countryName(p.countryCode) ?? p.countryCode].filter(Boolean).join(", ")}
                      {" · "}
                      {tb(`type.${p.type}`)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            <a href={mapHref} className="inline-block text-[13px] px-4 py-2 rounded-md font-medium bg-accent text-accent-foreground">
              {t("openMap")}
            </a>
            <MerchantActions cta={cta} ctx={ctx} t={t} simpleHref={simpleHref} simpleLabel={simpleLabel} />
          </div>
        </div>
      )}

      <div className="mt-5 space-y-2">
        <div className={label}>{t("badgeTitle")}</div>
        <div className="flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/${locale}/coin/${slug}/badge.svg`} alt={badgeAlt} height={36} />
          <code className="text-[11px] text-muted bg-bg-tint border border-hairline rounded-md px-3 py-2 overflow-x-auto max-w-full">
            {snippet}
          </code>
        </div>
        <p className="text-[12px] text-muted">{t("badgeHint")}</p>
      </div>
    </section>
  );
}

/**
 * Кнопки продавца. Если компания есть хотя бы одна, показывается список «от
 * чьего имени», а не угаданная за человека компания, и рядом — возможность
 * оформить ещё одну. Компания на модерации остаётся в списке с пометкой:
 * прятать от человека его же компанию хуже, чем показать её статус.
 */
function MerchantActions({
  cta,
  ctx,
  t,
  simpleHref,
  simpleLabel,
  primary = false,
}: {
  cta: MerchantCta;
  ctx: CtaContext;
  t: (key: string, values?: Record<string, string | number>) => string;
  simpleHref: string | null;
  simpleLabel: string | null;
  primary?: boolean;
}) {
  const solid = "inline-block text-[13px] px-4 py-2 rounded-md font-medium bg-accent text-accent-foreground";
  const outline = "inline-block text-[13px] px-4 py-2 rounded-md border border-hairline hover:border-accent";

  if (cta.kind !== "choose") {
    if (!simpleHref || !simpleLabel) return null;
    return <a href={simpleHref} className={primary ? solid : outline}>{simpleLabel}</a>;
  }

  return (
    <div className="space-y-2">
      <div className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("addPointTo")}</div>
      <div className="flex flex-wrap gap-2">
        {cta.companies.map((c) => (
          <a key={c.id} href={addPointHref(c.id, ctx)} className={outline}>
            {c.displayName}
            {c.status !== "APPROVED" && (
              <span className="ml-2 text-[11px] text-muted">{t(`companyStatus.${c.status}`)}</span>
            )}
            {c.acceptedPoints > 0 && (
              <span className="ml-2 text-[11px] text-accent num">{c.acceptedPoints}</span>
            )}
          </a>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <a href={newCompanyHref(ctx)} className="underline text-muted hover:text-foreground">
          {t("orNewCompany")}
        </a>
        {cta.hasMore && (
          <a href={`/${ctx.locale}/cabinet#companies`} className="underline text-muted hover:text-foreground">
            {t("moreCompanies")}
          </a>
        )}
        {cta.acceptedTotal > 0 && (
          <span className="text-muted">
            {t("youAccept", { points: cta.acceptedTotal })}{" "}
            <a href={manageHref(cta.companies[0].id, ctx)} className="underline hover:text-foreground">
              {t("managePoints")}
            </a>
          </span>
        )}
      </div>
    </div>
  );
}
