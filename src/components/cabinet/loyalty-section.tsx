import { getFormatter, getTranslations } from "next-intl/server";
import { LOYALTY_LEVELS, levelFor } from "@/lib/loyalty/levels";

/**
 * «Кэшбэк и уровни» в кабинете покупателя: лестница платформы и своё место на ней.
 *
 * Оборот в сети считается с факта оплаты, а факта оплаты у нас нет — поэтому в функцию
 * уходит `null`, и экран говорит «оборот ещё не считается». Ноль сказал бы, что мы
 * посчитали и у человека ничего нет, а это неправда: мы не считали.
 */
export async function LoyaltySection() {
  const [t, format] = await Promise.all([getTranslations("loyalty.levels"), getFormatter()]);
  const standing = levelFor(null);

  const usd = (v: number) => {
    try {
      return format.number(v, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    } catch {
      return `$${v}`;
    }
  };

  return (
    <section id="loyalty">
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h2>
      <p className="text-sm text-muted mb-4">{t("subtitle")}</p>

      <p className="text-sm mb-4">
        {t("yours", { level: t(`names.${standing.level.key}`) })}
        <span className="text-muted"> · {standing.measured ? "" : t("notMeasured")}</span>
      </p>

      <ul className="space-y-2">
        {LOYALTY_LEVELS.map((l) => (
          <li
            key={l.key}
            className={`flex items-center gap-3 border rounded-md px-3 py-2.5 ${
              l.key === standing.level.key ? "border-accent" : "border-hairline"
            }`}
          >
            <span className="font-medium">{t(`names.${l.key}`)}</span>
            <span className="num text-xs text-muted">{t("from", { amount: usd(l.minTurnoverUsd) })}</span>
            <span className="num text-xs text-muted ml-auto">
              {l.platformBonusPercent > 0 ? t("bonus", { points: l.platformBonusPercent }) : t("noBonus")}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-muted mt-3">{t("note")}</p>
    </section>
  );
}
