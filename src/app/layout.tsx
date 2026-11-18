import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

const SITE = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Trientes — the ledger of digital coinage",
    template: "%s · Trientes",
  },
  // Это значение по умолчанию для страниц вне отрезка локали (robots, sitemap,
  // корневое превью). Язык страницы перебивает его в `[locale]/layout.tsx`.
  description:
    "Live prices, exchanges, fintech directory and an on-the-ground crypto navigator.",
  applicationName: "Trientes",
  openGraph: {
    type: "website",
    siteName: "Trientes",
    title: "Trientes — the ledger of digital coinage",
    description:
      "Live prices, exchanges, fintech directory and an on-the-ground crypto navigator.",
    url: SITE,
  },
  twitter: {
    card: "summary_large_image",
    title: "Trientes",
    description:
      "Live prices, exchanges, fintech directory and crypto navigator.",
  },
  // Корневого `canonical` здесь нет намеренно: метаданные корня наследует
  // каждая страница, и `canonical: SITE` объявлял дубликатом главной всё, у
  // чего нет своих метаданных — `/sk/markets`, `/sk/exchanges`, `/en/compare`
  // и прочие. Свой адрес каждая страница объявляет сама.
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrains.variable}`}
    >
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          forcedTheme="dark"
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
