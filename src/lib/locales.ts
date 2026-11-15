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
  "hr",
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
  hr: "Hrvatski",
};

/**
 * Язык голосовых подсказок навигатора.
 *
 * Код локали интерфейса голосу не годится как есть: браузеру нужен полный тег
 * BCP-47, иначе на голом `ru` или `pt` он берёт случайный голос из семьи — а
 * бразильцу читать текст португальским из Лиссабона так же неуютно, как
 * наоборот. Список живёт рядом с локалями, потому что разойтись им нельзя:
 * новый язык интерфейса без голоса — это немой навигатор.
 */
export const SPEECH_LANG: Record<Locale, string> = {
  en: "en-US",
  ru: "ru-RU",
  "zh-CN": "zh-CN",
  es: "es-ES",
  ja: "ja-JP",
  ko: "ko-KR",
  de: "de-DE",
  fr: "fr-FR",
  "pt-BR": "pt-BR",
  tr: "tr-TR",
  hr: "hr-HR",
};

export function speechLang(locale: string): string {
  return SPEECH_LANG[locale as Locale] ?? locale;
}
