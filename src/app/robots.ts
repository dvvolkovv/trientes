import type { MetadataRoute } from "next";

const SITE = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Block authenticated areas, internal API, and the moderator UI.
        // Search engines waste budget if they crawl these.
        disallow: ["/api/", "/admin/", "/cabinet", "/business/fintech", "/login", "/register"],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
