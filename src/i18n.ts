import { getRequestConfig } from "next-intl/server";
import { notFound } from "next/navigation";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/locales";

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) as Locale | undefined;
  if (!locale || !SUPPORTED_LOCALES.includes(locale)) notFound();
  const messages = (await import(`../messages/${locale}.json`)).default;
  return { locale, messages };
});
