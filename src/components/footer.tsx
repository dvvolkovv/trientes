import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

export async function Footer() {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-20 bg-bg-tint border-t border-hairline">
      <div className="max-w-[1600px] mx-auto px-6 md:px-12 xl:px-20 py-10 md:py-16">
        <div className="grid grid-cols-12 gap-8">
          {/* Brand + tagline */}
          <div className="col-span-12 md:col-span-5">
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-[18px] font-bold tracking-[-0.02em] text-foreground">
                trientes
              </span>
              <span className="num text-[10px] font-medium uppercase tracking-[0.25em] px-1.5 py-0.5 rounded-sm text-accent border border-accent/40">
                .org
              </span>
            </div>
            <p className="text-[14px] leading-[1.6] max-w-[420px] text-muted">
              {t("tagline")} A sibling of{" "}
              <Link
                href="https://trientes.com"
                className="underline hover:text-foreground transition-colors"
              >
                trientes.com
              </Link>
              , focused on tracking top Layer-1 cryptocurrencies.
            </p>
          </div>

          {/* Markets */}
          <div className="col-span-6 md:col-span-2">
            <div className="text-[10px] uppercase tracking-[0.18em] mb-3 text-muted">
              Markets
            </div>
            <ul className="space-y-2 text-[14px]">
              <li>
                <Link
                  href={`/${locale}`}
                  className="text-muted hover:text-foreground transition-colors"
                >
                  Coins
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/exchanges`}
                  className="text-muted hover:text-foreground transition-colors"
                >
                  {t("exchanges")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/watchlist`}
                  className="text-muted hover:text-foreground transition-colors"
                >
                  {t("watchlist")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Account */}
          <div className="col-span-6 md:col-span-2">
            <div className="text-[10px] uppercase tracking-[0.18em] mb-3 text-muted">
              Account
            </div>
            <ul className="space-y-2 text-[14px]">
              <li>
                <Link
                  href={`/${locale}/login`}
                  className="text-muted hover:text-foreground transition-colors"
                >
                  {t("signIn")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/settings`}
                  className="text-muted hover:text-foreground transition-colors"
                >
                  {t("settings")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/request`}
                  className="text-muted hover:text-foreground transition-colors"
                >
                  {t("request")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Data */}
          <div className="col-span-12 md:col-span-3">
            <div className="text-[10px] uppercase tracking-[0.18em] mb-3 text-muted">
              Data
            </div>
            <p className="text-[12px] leading-[1.6] text-muted">
              Prices via CoinGecko + Binance WS. Refreshed every 10 min, live
              ticks for top 20 via SSE.
            </p>
          </div>
        </div>

        <div className="mt-12 pt-6 flex flex-col items-start gap-2 md:flex-row md:items-center md:justify-between num text-[11px] uppercase tracking-[0.18em] text-muted border-t border-hairline">
          <div>
            &copy; {year} {t("appName")}
          </div>
          <div>v0.1.0 &middot; MMXXVI</div>
        </div>
      </div>
    </footer>
  );
}
