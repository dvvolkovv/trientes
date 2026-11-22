"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CardOpenBadge } from "@/components/company-card/open-badge";
import { CARD_HEADING, CARD_PANEL } from "@/lib/company-card-ui";
import { WEEK_DAYS } from "@/lib/opening-hours";
import { logoBoxClass, logoImageClass } from "@/lib/company-logo";
import { merchantCategory } from "@/lib/merchant-categories";
import { industry as industryOf } from "@/lib/industries";
import { paymentMethod } from "@/lib/payment-methods";
import type { CardHours, CardPoint, CompanyCardView } from "@/lib/company-card/view";
import type { AcceptedCoin } from "@/lib/crypto-map";

/** Шапка: знак, имя, лицо, место, виды — колонкой по центру (просьба владельца 22.11). */
export function CardIdentity({ card, compact = false }: { card: CompanyCardView; compact?: boolean }) {
  const tb = useTranslations("business");
  const t = useTranslations("companyPublic");
  const category = merchantCategory(card.categoryKey);
  const industry = industryOf(card.industryKey);
  return (
    <div className={`flex flex-col items-center gap-2 text-center ${compact ? "" : "px-5 pt-8 pb-5"}`}>
      <div className={`${logoBoxClass(card.logoShape)} ${compact ? "h-14 w-14" : "h-20 w-20"} shrink-0`}>
        {card.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.logoUrl} alt="" className={logoImageClass(card.logoFit)} />
        ) : (
          <span className="text-2xl" aria-hidden>🏢</span>
        )}
      </div>
      <h1 className={`mt-1 font-bold leading-tight tracking-[-0.02em] ${compact ? "text-[20px]" : "text-[26px] md:text-[32px]"}`}>
        {card.displayName}
      </h1>
      {card.verified ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2.5 py-1 text-[12px] font-medium text-green-500">
          ✓ {t("verified")}
        </span>
      ) : null}
      {card.legalName ? <p className="text-sm text-muted">{card.legalName}</p> : null}
      {card.city || card.country ? (
        <p className="text-sm text-muted">{[card.city, card.country].filter(Boolean).join(", ")}</p>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-[12px]">
        {category ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-bg-tint px-2 py-0.5">
            <span aria-hidden>{category.emoji}</span>
            {tb(`category.${category.key}`)}
          </span>
        ) : null}
        {industry ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-bg-tint px-2 py-0.5">
            <span aria-hidden>{industry.emoji}</span>
            {tb(`industryKind.${industry.key}`)}
          </span>
        ) : null}
        {card.industryCustom ? (
          <span className="inline-flex items-center rounded-full border border-hairline bg-bg-tint px-2 py-0.5">
            {card.industryCustom}
          </span>
        ) : null}
        {card.mode !== "none" ? (
          <span className="inline-flex items-center rounded-full border border-hairline bg-bg-tint px-2 py-0.5">
            {t(`mode.${card.mode}`)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-[11px] uppercase tracking-wider text-muted">{label}</div>
      {children}
    </div>
  );
}

/**
 * Реквизиты и контакты — одним баннером (решение владельца). Прежде это были две
 * панели, и человек читал про одно предприятие дважды.
 */
export function CardRequisites({
  card,
  hideAddress = false,
}: {
  card: CompanyCardView;
  /**
   * В навигаторе адрес уже стоит строкой самой точки — а это адрес места, куда
   * человек поедет. Повтор юридического адреса рядом читается как две разные
   * правды об одном (живой прогон BY).
   */
  hideAddress?: boolean;
}) {
  const t = useTranslations("companyPublic");
  const r = card.requisites;
  const tel = r.phone ? `tel:${r.phone.replace(/[^\d+]/g, "")}` : null;
  const address = hideAddress ? null : r.address;
  const any =
    r.legalName || r.registrationNumber || r.taxNumber || r.phone || r.email || r.website || address || r.returnsShown;
  if (!any) return null;
  return (
    <section className={CARD_PANEL}>
      <h2 className={CARD_HEADING}>{t("requisitesAndContacts")}</h2>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        {r.legalName ? <Field label={t("legalName")}><span>{r.legalName}</span></Field> : null}
        {r.registrationNumber ? (
          <Field label={t("registrationNumber")}>
            <span className="font-mono text-[13px]">{r.registrationNumber}</span>
          </Field>
        ) : null}
        {r.taxNumber ? (
          <Field label={t("taxNumber")}>
            <span className="font-mono text-[13px]">{r.taxNumber}</span>
          </Field>
        ) : null}
        {r.phone ? (
          <Field label={t("phone")}>
            <a href={tel ?? "#"} className="text-accent underline">{r.phone}</a>
          </Field>
        ) : null}
        {r.email ? (
          <Field label={t("email")}>
            <a href={`mailto:${r.email}`} className="text-accent underline">{r.email}</a>
          </Field>
        ) : null}
        {r.website ? (
          <Field label={t("website")}>
            <a href={r.website} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline">
              {r.website.replace(/^https?:\/\//, "")}
            </a>
          </Field>
        ) : null}
        {address ? (
          <div className="sm:col-span-2">
            <Field label={t("address")}><span>{address}</span></Field>
          </div>
        ) : null}
        {r.returnsShown ? (
          <div className="sm:col-span-2">
            <Field label={t("returns")}>
              {r.returnPolicy || r.returnDays !== null ? (
                <span className="whitespace-pre-wrap">
                  {r.returnDays !== null ? <span className="num">{t("returnDays", { days: r.returnDays })}</span> : null}
                  {r.returnDays !== null && r.returnPolicy ? " · " : null}
                  {r.returnPolicy}
                </span>
              ) : (
                <span className="text-muted">{t("returnsUnknown")}</span>
              )}
            </Field>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Неделя. Сегодняшний день выделен — его и ищут глазом. */
export function CardWeek({ hours }: { hours: CardHours }) {
  const t = useTranslations("business.hours");
  if (!hours.week) return null;
  return (
    <div className="space-y-0.5">
      {WEEK_DAYS.map((day) => {
        const d = hours.week?.[day] ?? { kind: "closed" as const };
        const today = hours.state.today === day;
        return (
          <div
            key={day}
            className={`flex items-baseline justify-between gap-3 text-[12.5px] ${today ? "font-semibold" : "text-muted"}`}
          >
            <span>{t(`day.${day}`)}</span>
            <span className="num text-right">
              {d.kind === "allday"
                ? t("kind.allday")
                : d.kind === "closed"
                  ? t("kind.closed")
                  : d.spans.map((s) => `${s[0]}–${s[1]}`).join(", ")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Часы: заголовок слева, состояние **на той же строке справа** — так просил владелец,
 * и так его видно, не читая таблицы.
 */
export function CardHoursPanel({ hours, hint }: { hours: CardHours; hint?: string }) {
  const t = useTranslations("companyPublic");
  return (
    <section className={CARD_PANEL}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className={`${CARD_HEADING} mb-0 whitespace-nowrap`}>{t("officeHoursTitle")}</h2>
        <CardOpenBadge state={hours.state} />
      </div>
      <CardWeek hours={hours} />
      {hint ? <p className="mt-2 text-[12px] text-muted">{hint}</p> : null}
    </section>
  );
}

/**
 * Точка приёма — баннер во всю ширину, нажатие ведёт в навигатор на саму точку.
 * Прежде это была строка с фотографией 80×80 («маленький кубик», жалоба владельца):
 * место, куда человек поедет, не может быть мельче логотипа.
 */
export function CardPointBanner({ point, locale }: { point: CardPoint; locale: string }) {
  const t = useTranslations("companyPublic");
  const tb = useTranslations("business");
  const category = merchantCategory(point.categoryKey);
  const inner = (
    <>
      {point.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={point.photo} alt="" loading="lazy" className="h-full w-full object-cover opacity-80" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-card-alt text-[34px]" aria-hidden>
          {category?.emoji ?? "📍"}
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/35 to-black/85" />
      {point.hours ? <div className="absolute left-3 top-3"><CardOpenBadge state={point.hours.state} /></div> : null}
      <div className="absolute inset-x-3 bottom-3 flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-bold text-white">{point.name}</div>
          <div className="truncate text-[12.5px] text-white/75">
            {point.address ?? (category ? tb(`category.${category.key}`) : "")}
          </div>
        </div>
        {point.mappable ? (
          <span className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white px-3 text-[12px] font-bold text-black">
            📍 {t("openOnMap")} →
          </span>
        ) : null}
      </div>
    </>
  );
  const shell = "relative block aspect-[16/9] w-full overflow-hidden rounded-[22px] border border-hairline bg-bg-tint";
  return point.mappable ? (
    <Link href={`/${locale}/crypto-map?point=${point.id}`} className={shell} data-testid="point-banner">
      {inner}
    </Link>
  ) : (
    <div className={shell}>{inner}</div>
  );
}

/** «Принимаем к оплате»: логотипы монет и способы оплаты помимо них. */
export function CardPayments({
  coins,
  payments,
  locale,
}: {
  coins: AcceptedCoin[];
  payments: string[];
  locale: string;
}) {
  const t = useTranslations("companyCard");
  if (coins.length === 0 && payments.length === 0) return null;
  return (
    <section className={CARD_PANEL}>
      <h2 className={CARD_HEADING}>{t("paymentsTitle")}</h2>
      <div className="flex flex-wrap gap-2">
        {coins.map((c) => {
          const chip = (
            <>
              {c.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.logoUrl} alt="" loading="lazy" className="h-[26px] w-[26px] rounded-full bg-white" />
              ) : (
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-card-alt text-[11px] font-bold">
                  {c.symbol.slice(0, 2)}
                </span>
              )}
              <span className="text-[12.5px] font-semibold">{c.symbol}</span>
            </>
          );
          return c.slug ? (
            <Link
              key={`${c.own ? "card" : "coin"}-${c.key}`}
              href={`/${locale}/coin/${c.slug}`}
              className="inline-flex items-center gap-2 rounded-full border border-hairline bg-bg-tint py-1.5 pl-1.5 pr-3 transition-colors hover:border-accent/60"
            >
              {chip}
            </Link>
          ) : (
            <span
              key={`${c.own ? "card" : "coin"}-${c.key}`}
              className="inline-flex items-center gap-2 rounded-full border border-hairline bg-bg-tint py-1.5 pl-1.5 pr-3"
            >
              {chip}
            </span>
          );
        })}
      </div>
      {payments.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {payments.map((key) => {
            const m = paymentMethod(key);
            if (!m) return null;
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-bg-tint px-3 py-1.5 text-[12px] text-muted-strong"
              >
                <span aria-hidden>{m.emoji}</span>
                {t(`payment.${m.key}`)}
              </span>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
