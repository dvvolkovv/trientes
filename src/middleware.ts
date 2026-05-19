import createIntlMiddleware from "next-intl/middleware";
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "@/lib/locales";

const intlMiddleware = createIntlMiddleware({
  locales: [...SUPPORTED_LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
});

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  return intlMiddleware(req);
});

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
