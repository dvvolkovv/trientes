import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { LocaleSwitcher } from "./locale-switcher";
import { CurrencySwitcher } from "./currency-switcher";
import { MobileNav } from "./mobile-nav";
import { getCurrency } from "@/lib/get-currency";

export async function Navbar() {
  const session = await auth();
  const locale = await getLocale();
  const t = await getTranslations("common");
  const currency = await getCurrency();
  const isAdmin =
    (session?.user as { role?: string } | undefined)?.role === "ADMIN";

  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-[rgba(22,22,22,0.85)] border-b border-hairline">
      <div className="max-w-[1600px] mx-auto px-6 md:px-12 xl:px-20 h-16 flex items-center gap-4">
        <MobileNav>
          <nav className="flex flex-col mt-2 mb-6">
            <Link
              href={`/${locale}`}
              className="block py-3 text-base text-foreground hover:text-accent border-b border-hairline transition-colors"
            >
              Coins
            </Link>
            <Link
              href={`/${locale}/exchanges`}
              className="block py-3 text-base text-foreground hover:text-accent border-b border-hairline transition-colors"
            >
              {t("exchanges")}
            </Link>
            <Link
              href={`/${locale}/markets`}
              className="block py-3 text-base text-foreground hover:text-accent border-b border-hairline transition-colors"
            >
              {t("markets")}
            </Link>
            <Link
              href={`/${locale}/watchlist`}
              className="block py-3 text-base text-foreground hover:text-accent border-b border-hairline transition-colors"
            >
              {t("watchlist")}
            </Link>
            <Link
              href={`/${locale}/request`}
              className="block py-3 text-base text-foreground hover:text-accent border-b border-hairline transition-colors"
            >
              {t("request")}
            </Link>
            {isAdmin && (
              <Link
                href={`/${locale}/admin`}
                className="block py-3 text-base text-foreground hover:text-accent border-b border-hairline last:border-0 transition-colors"
              >
                {t("admin")}
              </Link>
            )}
          </nav>

          <div className="mb-6">
            <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted mb-3">
              Settings
            </div>
            <div className="flex items-center gap-2">
              <CurrencySwitcher current={currency} />
              <LocaleSwitcher />
            </div>
          </div>

          <div className="mt-auto">
            {session?.user ? (
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: `/${locale}` });
                }}
              >
                <button
                  type="submit"
                  className="w-full text-sm px-4 py-3 rounded-md font-medium uppercase tracking-wider text-muted hover:text-foreground border border-hairline hover:bg-card-alt transition-colors"
                >
                  {t("signOut")}
                </button>
              </form>
            ) : (
              <Link
                href={`/${locale}/login`}
                className="block w-full text-center text-sm px-4 py-3 rounded-full font-semibold uppercase tracking-wider bg-blue text-blue-foreground transition-all hover:brightness-110"
              >
                {t("signIn")}
              </Link>
            )}
          </div>
        </MobileNav>

        <Link
          href={`/${locale}`}
          className="flex items-baseline gap-2"
          aria-label={t("appName")}
        >
          <span className="text-[20px] font-bold tracking-[-0.02em] text-foreground">
            trientes
          </span>
          <span className="num text-[10px] font-medium uppercase tracking-[0.25em] px-1.5 py-0.5 rounded-sm text-accent border border-accent/40">
            .org
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm text-muted">
          <Link
            href={`/${locale}`}
            className="hover:text-foreground transition-colors"
          >
            Coins
          </Link>
          <Link
            href={`/${locale}/exchanges`}
            className="hover:text-foreground transition-colors"
          >
            {t("exchanges")}
          </Link>
          <Link
            href={`/${locale}/markets`}
            className="hover:text-foreground transition-colors"
          >
            {t("markets")}
          </Link>
          <Link
            href={`/${locale}/watchlist`}
            className="hover:text-foreground transition-colors"
          >
            {t("watchlist")}
          </Link>
          <Link
            href={`/${locale}/request`}
            className="hover:text-foreground transition-colors"
          >
            {t("request")}
          </Link>
          {isAdmin && (
            <Link
              href={`/${locale}/admin`}
              className="hover:text-foreground transition-colors"
            >
              {t("admin")}
            </Link>
          )}
        </nav>

        <div className="ml-auto hidden md:flex items-center gap-2">
          <CurrencySwitcher current={currency} />
          <LocaleSwitcher />
          {session?.user ? (
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: `/${locale}` });
              }}
            >
              <button
                type="submit"
                className="text-xs px-3 py-1.5 rounded-md font-medium uppercase tracking-wider text-muted hover:text-foreground transition-colors"
              >
                {t("signOut")}
              </button>
            </form>
          ) : (
            <Link
              href={`/${locale}/login`}
              className="ml-2 text-xs px-4 py-1.5 rounded-full font-semibold uppercase tracking-wider bg-blue text-blue-foreground transition-all hover:brightness-110"
            >
              {t("signIn")}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
