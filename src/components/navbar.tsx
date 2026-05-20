import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { auth, signIn, signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";
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
    <header className="border-b">
      <div className="container mx-auto px-4 py-3 flex items-center gap-4">
        <Link href={`/${locale}`} className="font-bold text-lg">
          {t("appName")}
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href={`/${locale}/watchlist`}>{t("watchlist")}</Link>
          <Link href={`/${locale}/request`}>{t("request")}</Link>
          {isAdmin && <Link href={`/${locale}/admin`}>{t("admin")}</Link>}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitcher />
          <CurrencySwitcher current={currency} />
          <ThemeToggle />
          {session?.user ? (
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: `/${locale}` });
              }}
            >
              <Button variant="ghost" size="sm" type="submit">
                {t("signOut")}
              </Button>
            </form>
          ) : (
            <Button asChild size="sm">
              <Link href={`/${locale}/login`}>{t("signIn")}</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
