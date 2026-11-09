import { getTranslations } from "next-intl/server";

type Trust = "UNVERIFIED" | "CONTRACT_VERIFIED" | "PROJECT_CLAIMED" | "FULLY_VERIFIED";
type Variant = Trust | "SEEDED";

const TONE: Record<Variant, string> = {
  UNVERIFIED: "border-down/40 text-down",
  CONTRACT_VERIFIED: "border-hairline text-foreground",
  PROJECT_CLAIMED: "border-accent/40 text-accent",
  FULLY_VERIFIED: "border-up/40 text-up",
  SEEDED: "border-hairline text-foreground",
};

/**
 * Плашка доверия. Отдельный вариант `SEEDED` — для карточки, которую завели мы,
 * а не проект: у неё нет ни куратора, ни компании, и писать «проект не
 * подтвердил причастность» было бы странно — проект к нам и не приходил.
 * Вместо этого говорим прямо, откуда числа, и приглашаем забрать карточку.
 */
export async function TrustPlaque({
  trust,
  seeded = false,
  locale,
}: {
  trust: Trust;
  seeded?: boolean;
  locale?: string;
}) {
  const t = await getTranslations("coinCard.trust");
  const variant: Variant = seeded ? "SEEDED" : trust;
  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${TONE[variant]}`}>
      <span className="font-semibold uppercase tracking-[0.12em] text-[12px] mr-2">
        {t(variant)}
      </span>
      <span className="text-muted">{t(`${variant}_note`)}</span>
      {seeded && locale && (
        <a href={`/${locale}/request`} className="text-accent ml-2 underline">
          {t("SEEDED_cta")}
        </a>
      )}
    </div>
  );
}
