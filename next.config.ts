import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lets a preview build land in its own directory (NEXT_DIST_DIR=.next-preview npm run
  // build) so screenshotting a change never overwrites the .next the live server serves.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "coin-images.coingecko.com" },
      { protocol: "https", hostname: "assets.coingecko.com" },
    ],
  },
};

export default withNextIntl(nextConfig);
