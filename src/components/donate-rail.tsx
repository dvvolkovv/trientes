import { getTranslations } from "next-intl/server";
import { donateHref } from "@/lib/dex-link";
import { donateLimits, donatePresets, readDonateTerms } from "@/lib/donations";

/**
 * Пожертвование на главной: суммы нажатием и «другая сумма».
 *
 * Сам платёж делает экран пожертвований обмена (`/exchange/#/donate`) — ссылка
 * ведёт туда с выбранной суммой в адресе, и она же подставляется в его поле.
 * Поэтому здесь обычный `<a>`, а не `Link`: обмен — отдельное приложение на
 * своём пути, и клиентский переход маршрутизатора сайта его не откроет.
 *
 * Суммы называет служба (`src/lib/donations.ts`), а не мы: сегодняшние пределы
 * ходят за запасом монеты выплаты и её ценой. Не ответила, ответила не своей
 * формой или пожертвования закрыты — раздела на главной нет вовсе.
 *
 * Суммы в долларах и остаются в долларах: служба считает пожертвование в $, и
 * пересчёт в выбранную на сайте валюту обещал бы платёж, которого не будет.
 */
export async function DonateRail({ locale }: { locale: string }) {
  const terms = await readDonateTerms();
  if (!terms || !terms.accepting) return null;
  const t = await getTranslations("home.donate");
  const tk = await getTranslations("common");
  const presets = donatePresets(terms);
  const limits = donateLimits(terms);

  return (
    <section className="pb-12">
      <div className="num text-[11px] uppercase tracking-[0.3em] text-accent inline-flex items-center gap-2 mb-5">
        <span className="w-2 h-2 rounded-full bg-accent" aria-hidden />
        {tk("kicker.support")}
      </div>
      <div className="border border-hairline rounded-[14px] p-6 md:p-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div className="max-w-[560px]">
          <h2 className="text-[22px] md:text-[26px] font-bold tracking-[-0.02em]">
            {t("heading")}
          </h2>
          <p className="text-muted text-[14px] mt-2">{t("lede")}</p>
          {limits ? (
            <p className="num text-[12px] text-muted mt-2">{t("limits", limits)}</p>
          ) : null}
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t("presetsLabel")}
        >
          {presets.map((p) => (
            <a
              key={p}
              href={donateHref(locale, p)}
              className="num bg-accent text-accent-foreground glow-accent rounded-full px-5 py-2.5 text-sm font-semibold hover:brightness-110 transition-all"
            >
              {`$${p}`}
            </a>
          ))}
          <a
            href={donateHref(locale)}
            className="rounded-full border border-hairline px-5 py-2.5 text-sm text-muted hover:text-foreground hover:border-accent/50 transition-colors"
          >
            {t("other")}
          </a>
        </div>
      </div>
    </section>
  );
}
