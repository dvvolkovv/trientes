import createIntlMiddleware from "next-intl/middleware";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "@/lib/locales";

// Auth gating (logged-in check + admin role check) is handled in server-side
// layouts (src/app/[locale]/admin/layout.tsx etc.) — they have DB access via
// Prisma, which the edge runtime middleware does not. Trying to validate
// database-strategy sessions in middleware causes "Invalid Compact JWE"
// errors because the session cookie is a UUID, not a JWT.
const intlMiddleware = createIntlMiddleware({
  locales: [...SUPPORTED_LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
});

export default intlMiddleware;

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
