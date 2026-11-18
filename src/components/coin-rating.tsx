import { getTranslations } from "next-intl/server";
import { readRatingSummary } from "@/lib/ratings";
import { isAuthenticated } from "@/lib/watchlist";
import { RatingStars } from "./rating-stars";

/**
 * Раздел с оценкой монеты. Ключ оценки — то, что стоит в адресе страницы
 * (`/coin/<coinKey>`): страница у монеты одна, независимо от того, заведена она
 * строкой `Coin`, карточкой или обеими сразу.
 */
export async function CoinRating({
  coinKey,
  locale,
}: {
  coinKey: string;
  locale: string;
}) {
  const [summary, isAuthed, t] = await Promise.all([
    readRatingSummary(coinKey),
    isAuthenticated(),
    getTranslations("rating"),
  ]);
  return (
    <section id="rating" className="scroll-mt-24">
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-3">
          {t("heading")}
        </div>
        <RatingStars
          coinKey={coinKey}
          initial={summary}
          isAuthed={isAuthed}
          locale={locale}
        />
      </div>
    </section>
  );
}
