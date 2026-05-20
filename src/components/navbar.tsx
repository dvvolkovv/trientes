import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { LocaleSwitcher } from "./locale-switcher";
import { CurrencySwitcher } from "./currency-switcher";
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
      <div className="max-w-[1600px] mx-auto px-6 md:px-12 xl:px-20 h-16 flex items-center gap-8">
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

        <div className="ml-auto flex items-center gap-2">
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
              className="ml-2 text-xs px-4 py-1.5 rounded-md font-semibold uppercase tracking-wider bg-accent text-accent-foreground transition-all hover:brightness-110"
            >
              {t("signIn")}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
