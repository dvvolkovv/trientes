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
  /**
   * Страница приёма платежей (слайс CP) не открывается во фрейме.
   *
   * Это **единственная** CSP, которую вводит слайс, и только `frame-ancestors`
   * (скрипты она не ограничивает) — согласовано с dex-9b 27.11. Смысл: нажатие «да»,
   * которое меняет получателя денег, нельзя подсунуть через чужой фрейм.
   *
   * Почему здесь, а не в nginx: `add_header` в новом `location` отменяет заголовки,
   * унаследованные с уровня `server`, и с этой страницы пропал бы HSTS. Префикс
   * локали в образце — чтобы покрыть все двенадцать языков сразу.
   */
  async headers() {
    return [
      {
        source: "/:locale/cabinet/companies/:id/payments",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // Подтверждение личности ведёт к тому же действию, значит и защита та же.
        source: "/:locale/cabinet/reauth",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
