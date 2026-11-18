import { Suspense } from "react";
import type { Metadata } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale, getMessages, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/locales";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { AnalyticsTracker } from "@/components/analytics-tracker";

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

/**
 * Заголовок и описание страницы — на языке страницы.
 *
 * Корневой `app/layout.tsx` стоит выше отрезка локали и языка не знает, поэтому
 * его заголовок уходил английским во все одиннадцать языков: в выдаче поиска и
 * в превью ссылки японец видел английскую строку. Здесь заголовок читается из
 * того же файла переводов, что и остальной интерфейс, а число языков берётся из
 * `SUPPORTED_LOCALES` — вписанное руками оно уже разошлось со списком.
 *
 * Чего здесь **нет** и быть не должно: `alternates`. Метаданные раскладки
 * наследует каждая страница под ней, и canonical раскладки объявил бы
 * `/sk/markets` дубликатом `/sk` — живой прогон это и показал. Ссылки на
 * переводы живут у самой страницы: у главной — ниже, у остальных — в
 * `sitemap.xml`, который строит их из `SUPPORTED_LOCALES`.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(SUPPORTED_LOCALES, locale)) return {};
  const t = await getTranslations({ locale, namespace: "common.meta" });
  const title = t("title");
  const description = t("description", { count: SUPPORTED_LOCALES.length });
  return {
    // `absolute`, а не строка и не `default`: и то и другое корневая раскладка
    // прогоняет через свой шаблон «%s · Trientes», и заголовок главной читался
    // «Trientes — … · Trientes». Шаблон тут же объявлен заново — он нужен
    // страницам ниже, у которых заголовок свой.
    title: { absolute: title, template: "%s · Trientes" },
    description,
    openGraph: { title, description, locale },
    twitter: { title, description },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(SUPPORTED_LOCALES, locale)) notFound();
  setRequestLocale(locale as Locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1">{children}</div>
        <Footer />
      </div>
      <Suspense fallback={null}>
        <AnalyticsTracker locale={locale} />
      </Suspense>
    </NextIntlClientProvider>
  );
}
