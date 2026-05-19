export const SUPPORTED_LOCALES = [
  "en",
  "ru",
  "zh-CN",
  "es",
  "ja",
  "ko",
  "de",
  "fr",
  "pt-BR",
  "tr",
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
  "zh-CN": "中文",
  es: "Español",
  ja: "日本語",
  ko: "한국어",
  de: "Deutsch",
  fr: "Français",
  "pt-BR": "Português (BR)",
  tr: "Türkçe",
};
