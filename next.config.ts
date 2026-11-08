import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lets a preview build land in its own directory (NEXT_DIST_DIR=.next-preview npm run
  // build) so screenshotting a change never overwrites the .next the live server serves.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  async headers() {
    const immutable = {
      key: "Cache-Control",
      value: "public, max-age=31536000, immutable",
    };
    return [
      {
        source:
          "/maplibre/:version(\\d+\\.\\d+\\.\\d+)/:asset(maplibre-gl-(?:worker|shared)\\.mjs)",
        headers: [immutable],
      },
      {
        source: "/maplibre/:asset(maplibre-gl-(?:worker|shared)\\.mjs)",
        headers: [immutable],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "coin-images.coingecko.com" },
      { protocol: "https", hostname: "assets.coingecko.com" },
    ],
  },
};

export default withNextIntl(nextConfig);
