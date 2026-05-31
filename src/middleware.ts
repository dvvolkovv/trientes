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
  // Excludes:
  // - api / _next / _vercel internals
  // - anything with a dot (static assets, robots.txt, sitemap.xml, robots/sitemap.txml routes)
  // - root-level Next.js metadata file routes (opengraph-image, twitter-image,
  //   icon, apple-icon, manifest) so the i18n middleware doesn't 307 them to
  //   /en/opengraph-image, which doesn't exist as a route.
  matcher: ["/((?!api|_next|_vercel|opengraph-image|twitter-image|icon|apple-icon|manifest|.*\\..*).*)"],
};
