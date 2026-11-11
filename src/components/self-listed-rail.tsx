import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listSelfListedCards } from "@/lib/coin-card-directory";
import { formatPercent, formatPrice } from "@/lib/format";

const TRUST_TONE: Record<string, string> = {
  UNVERIFIED: "text-muted border-hairline",
  CONTRACT_VERIFIED: "text-up border-up/40",
  PROJECT_CLAIMED: "text-accent border-accent/40",
  FULLY_VERIFIED: "text-up border-up/40",
};

/**
 * Coins listed by their own teams rather than pulled from a market feed. Since
 * slice C a card shows a price as soon as our aggregator confirms at least one
 * market; cards with no confirmed market stay priceless rather than showing a
 * zero. The ranked table still needs capitalisation, which needs a verified
 * circulating supply (slice E).
 */
export async function SelfListedRail({ locale }: { locale: string }) {
  const t = await getTranslations("listing.selfListed");
  const tt = await getTranslations("coinCard.trust");
  const cards = await listSelfListedCards(24, locale);
  if (cards.length === 0) return null;

  return (
    <div>
      <p className="text-muted mb-6 max-w-[640px]">{t("subtitle")}</p>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <li key={c.id}>
            <Link
              href={`/${locale}/coin/${c.slug}`}
              className="flex gap-3 items-start border border-hairline rounded-[14px] p-4 hover:border-accent/50 transition-colors h-full"
            >
              {c.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.logoUrl}
                  alt=""
                  width={36}
                  height={36}
                  className="rounded-full border border-hairline shrink-0"
                />
              ) : (
                <span className="w-9 h-9 rounded-full border border-hairline shrink-0" />
              )}
              <span className="min-w-0">
                <span className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-semibold truncate">{c.name}</span>
                  <span className="num text-xs text-muted">{c.symbol}</span>
                </span>
                {c.priceUsd != null ? (
                  <span className="flex items-baseline gap-2 mt-1">
                    <span className="num text-sm font-semibold">${formatPrice(c.priceUsd)}</span>
                    {c.change24h != null ? (
                      <span
                        className={`num text-xs ${c.change24h >= 0 ? "text-up" : "text-down"}`}
                      >
                        {formatPercent(c.change24h)}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {c.tagline ? (
                  <span className="block text-[13px] text-muted mt-1 line-clamp-2">
                    {c.tagline}
                  </span>
                ) : null}
                <span
                  className={`inline-block mt-2 text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border ${
                    TRUST_TONE[c.trust] ?? TRUST_TONE.UNVERIFIED
                  }`}
                >
                  {tt(c.trust)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
