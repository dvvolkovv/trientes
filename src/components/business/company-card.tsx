import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { KybStatus, RequestStatus } from "@prisma/client";
import { ADMIN_BUTTON, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";
import {
  COMPANY_CARD_FIELDS,
  companyFieldLabelKey,
  type CompanyEditField,
  type FieldChange,
} from "@/lib/company-edit";
import { logoBoxClass, logoImageClass } from "@/lib/company-logo";
import { HoursTable, OpenBadge } from "@/components/business/hours-view";
import type { WeekHours } from "@/lib/opening-hours";

/**
 * Карточка предприятия: список «поле → значение» вместо всегда открытой формы
 * (слайс BM). До него сохранённого состояния не было видно нигде — человек смотрел
 * на четырнадцать полей ввода и не мог прочитать, что о нём написано.
 *
 * Незаполненное поле пишется словом «не указано», а не пропускается: пропущенное
 * поле не видно на экране, и человек не знает, что ещё можно дозаполнить.
 */

export type CompanyCardData = Partial<Record<CompanyEditField, string | null>> & {
  id: string;
  displayName: string;
  status: RequestStatus;
  kybStatus: KybStatus;
  kybRejectionReason: string | null;
  logoUrl: string | null;
  /** Слайс BU: форма логотипа и часы конторы. */
  logoShape?: string | null;
  logoFit?: string | null;
  hours?: WeekHours | null;
  timezone?: string | null;
};

const STATUS_CLASS: Record<string, string> = {
  APPROVED: "bg-green-500/15 text-green-500",
  REJECTED: "bg-red-500/15 text-red-500",
  PENDING: "bg-yellow-500/15 text-yellow-500",
  NONE: "bg-bg-tint text-muted",
};

export async function CompanyCard({
  company,
  locale,
  editable,
  isOwner,
  pendingChanges,
  editHref,
  kybHref,
}: {
  company: CompanyCardData;
  locale: string;
  editable: boolean;
  isOwner: boolean;
  /** Правка, ждущая модератора. Пусто — всё, что на экране, и есть на витрине. */
  pendingChanges: FieldChange[];
  editHref: string;
  kybHref: string;
}) {
  const t = await getTranslations("business");
  const tk = await getTranslations("business.kyb");
  const changed = new Set(pendingChanges.map((c) => c.field));

  return (
    <section className="space-y-4">
      <div className="rounded-[22px] border border-hairline bg-card p-4 md:p-6">
        <div className="flex items-start gap-3">
          {/* Форма и вписывание — из одного модуля на кабинет, витрину и каталог
              (слайс BU): вторая копия правила вида разошлась бы с первой. */}
          <div className={`${logoBoxClass(company.logoShape)} h-12 w-12 shrink-0`}>
            {company.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logoUrl} alt="" className={logoImageClass(company.logoFit)} />
            ) : (
              <span className="text-lg" aria-hidden>🏢</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[24px] font-bold leading-tight tracking-[-0.03em] break-words">
              {company.displayName}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-[11px] ${STATUS_CLASS[company.status] ?? ""}`}>
                {t(`statusBadge.${company.status}`)}
              </span>
              {/* Плашка проверки сама ведёт туда, где отправляют документы:
                  владелец прочитал «не отправлена» и нажать это было нечем. */}
              {isOwner && company.kybStatus !== "APPROVED" ? (
                <Link
                  href={kybHref}
                  className={`rounded px-2 py-0.5 text-[11px] underline-offset-2 hover:underline ${STATUS_CLASS[company.kybStatus] ?? STATUS_CLASS.NONE}`}
                >
                  {tk("title")}: {tk(`status.${company.kybStatus}`)}
                </Link>
              ) : (
                <span className={`rounded px-2 py-0.5 text-[11px] ${STATUS_CLASS[company.kybStatus] ?? STATUS_CLASS.NONE}`}>
                  {tk("title")}: {tk(`status.${company.kybStatus}`)}
                </span>
              )}
            </div>
          </div>
        </div>

        <dl className="mt-5 divide-y divide-hairline border-t border-hairline">
          {COMPANY_CARD_FIELDS.map((field) => {
            const value = company[field];
            return (
              <div key={field} className="flex flex-wrap gap-x-3 gap-y-0.5 py-2.5">
                <dt className="w-full text-[11px] uppercase tracking-wider text-muted sm:w-[40%]">
                  {t(companyFieldLabelKey(field))}
                </dt>
                <dd className="min-w-0 flex-1 break-words text-[13px]">
                  {value ? value : <span className="text-muted">{t("notSet")}</span>}
                  {changed.has(field) ? (
                    <span className="ml-2 rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] text-yellow-500">
                      {t("underReview")}
                    </span>
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>

        {pendingChanges.length > 0 ? (
          // Что именно ждёт решения — прямо здесь: «на проверке» без списка не
          // говорит, можно ли ещё раз править и что именно уйдёт модератору.
          <div className="mt-4 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3">
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-yellow-500">
              {t("pendingChanges", { count: pendingChanges.length })}
            </div>
            <ul className="space-y-1 text-[12px]">
              {pendingChanges.map((c) => (
                <li key={c.field} className="break-words">
                  <span className="text-muted">{t(companyFieldLabelKey(c.field))}: </span>
                  <span className="line-through opacity-60">{c.before ?? t("notSet")}</span>
                  {" → "}
                  <span className="font-medium">{c.after ?? t("notSet")}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted">{t("pendingChangesHint")}</p>
          </div>
        ) : null}

        {company.hours ? (
          // Часы конторы (слайс BU): когда отвечает телефон, почта и человек.
          // Часы торговли принадлежат точке — у сети из десяти магазинов общих
          // часов не бывает (правило BN), и наследования тут нет.
          <div className="mt-4 rounded-md border border-hairline bg-card-alt p-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-muted">{t("officeHours")}</span>
              <OpenBadge hours={company.hours} timezone={company.timezone ?? null} />
            </div>
            <HoursTable hours={company.hours} timezone={company.timezone ?? null} />
          </div>
        ) : null}

        <div className="mt-4 space-y-2">
          {/* Действие — кнопка во всю ширину, а не подчёркнутое слово в 11 px
              (правило AN): пальцем в слово не попасть. */}
          {company.status === "APPROVED" ? (
            <a
              href={`/${locale}/companies/${company.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className={ADMIN_BUTTON_SECONDARY}
            >
              {t("viewPublic")} ↗
            </a>
          ) : null}
          {editable ? (
            <Link href={editHref} className={ADMIN_BUTTON}>
              {t("editCard")}
            </Link>
          ) : null}
          {/* Проверка пройдена — это факт, а не задание: кнопка появляется только
              когда владельцу действительно есть что сделать. */}
          {isOwner && company.kybStatus !== "APPROVED" ? (
            <>
              <Link href={kybHref} className={ADMIN_BUTTON_SECONDARY}>
                {company.kybStatus === "NONE" ? tk("startCta") : tk("manageCta")}
              </Link>
              <p className="text-[11px] text-muted">{tk("whatIsIt")}</p>
            </>
          ) : null}
        </div>

        {isOwner && company.kybStatus === "REJECTED" && company.kybRejectionReason ? (
          <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-300">
            {company.kybRejectionReason}
          </p>
        ) : null}
      </div>
    </section>
  );
}
