/**
 * Проверка полей паспорта — чистая, рядом с правилами. Отказ говорит код, а не «не
 * удалось сохранить»: живой прогон слайса AS показал, что человек, которому не назвали
 * причину, нажимает кнопку снова.
 */
import { SUPPORTED_LOCALES, type Locale } from "@/lib/locales";
import { isProductCategory } from "@/lib/products/categories";
import { parseGtin } from "@/lib/products/gtin";
import { MAX_DOCS, MAX_PHOTOS, cleanAttributes, type ProductAttribute } from "@/lib/products/rules";

export const DOCUMENT_KINDS = ["certificate", "datasheet", "manual", "declaration", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type ProductPhoto = { url: string; label?: string };
export type ProductDocument = { kind: DocumentKind; url: string; label?: string };

export type ProductInput = {
  name?: unknown;
  brand?: unknown;
  manufacturerName?: unknown;
  category?: unknown;
  language?: unknown;
  gtin?: unknown;
  description?: unknown;
  usage?: unknown;
  ingredients?: unknown;
  attributes?: unknown;
  photos?: unknown;
  videoUrl?: unknown;
  documents?: unknown;
};

export type ProductData = {
  name: string;
  brand: string | null;
  manufacturerName: string | null;
  category: string;
  language: Locale;
  gtin: string | null;
  description: string;
  usage: string | null;
  ingredients: string | null;
  attributes: ProductAttribute[];
  photos: ProductPhoto[];
  videoUrl: string | null;
  documents: ProductDocument[];
};

export type ValidationReason =
  | "name_required"
  | "name_too_long"
  | "category_invalid"
  | "language_invalid"
  | "gtin_invalid"
  | "description_required"
  | "description_too_long"
  | "text_too_long"
  | "too_many_photos"
  | "too_many_documents"
  | "bad_media_url"
  | "bad_document_kind";

const MAX_NAME = 120;
const MAX_SHORT = 120;
const MAX_DESCRIPTION = 8000;
const MAX_TEXT = 4000;

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Адрес медиа принимаем только свой: файл пишет наш же маршрут загрузки, и чужая ссылка
 * в этом поле означала бы, что страница товара тянет картинку с чужого хоста (и чужие
 * заголовки) от имени нашего каталога.
 */
export function isOwnMediaUrl(v: unknown): v is string {
  return typeof v === "string" && /^\/uploads\/products\/[A-Za-z0-9_-]+\/[A-Za-z0-9]+\.[a-z0-9]{2,4}$/.test(v);
}

export function validateProductInput(input: ProductInput): { ok: true; data: ProductData } | { ok: false; reason: ValidationReason } {
  const name = text(input.name);
  if (!name) return { ok: false, reason: "name_required" };
  if (name.length > MAX_NAME) return { ok: false, reason: "name_too_long" };

  const category = text(input.category);
  if (!isProductCategory(category)) return { ok: false, reason: "category_invalid" };

  const language = text(input.language) || "en";
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(language)) return { ok: false, reason: "language_invalid" };

  const rawGtin = text(input.gtin);
  let gtin: string | null = null;
  if (rawGtin) {
    gtin = parseGtin(rawGtin);
    // Негодный код отвергается вслух: молча обнулив его, мы завели бы паспорт-двойник.
    if (!gtin) return { ok: false, reason: "gtin_invalid" };
  }

  const description = text(input.description);
  if (!description) return { ok: false, reason: "description_required" };
  if (description.length > MAX_DESCRIPTION) return { ok: false, reason: "description_too_long" };

  const usage = text(input.usage);
  const ingredients = text(input.ingredients);
  const brand = text(input.brand);
  const manufacturerName = text(input.manufacturerName);
  if (usage.length > MAX_TEXT || ingredients.length > MAX_TEXT) return { ok: false, reason: "text_too_long" };
  if (brand.length > MAX_SHORT || manufacturerName.length > MAX_NAME) return { ok: false, reason: "text_too_long" };

  const photosRaw = Array.isArray(input.photos) ? input.photos : [];
  if (photosRaw.length > MAX_PHOTOS) return { ok: false, reason: "too_many_photos" };
  const photos: ProductPhoto[] = [];
  for (const row of photosRaw) {
    const r = (row ?? {}) as Record<string, unknown>;
    if (!isOwnMediaUrl(r.url)) return { ok: false, reason: "bad_media_url" };
    const label = text(r.label);
    photos.push(label ? { url: r.url, label: label.slice(0, MAX_SHORT) } : { url: r.url });
  }

  const videoRaw = text(input.videoUrl);
  if (videoRaw && !isOwnMediaUrl(videoRaw)) return { ok: false, reason: "bad_media_url" };

  const docsRaw = Array.isArray(input.documents) ? input.documents : [];
  if (docsRaw.length > MAX_DOCS) return { ok: false, reason: "too_many_documents" };
  const documents: ProductDocument[] = [];
  for (const row of docsRaw) {
    const r = (row ?? {}) as Record<string, unknown>;
    if (!isOwnMediaUrl(r.url)) return { ok: false, reason: "bad_media_url" };
    const kind = text(r.kind);
    if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: "bad_document_kind" };
    const label = text(r.label);
    documents.push({ kind: kind as DocumentKind, url: r.url, label: label ? label.slice(0, MAX_SHORT) : undefined });
  }

  return {
    ok: true,
    data: {
      name,
      brand: brand || null,
      manufacturerName: manufacturerName || null,
      category,
      language: language as Locale,
      gtin,
      description,
      usage: usage || null,
      ingredients: ingredients || null,
      attributes: cleanAttributes(input.attributes),
      photos,
      videoUrl: videoRaw || null,
      documents,
    },
  };
}

/** Поля, по которым пишется история и считается расхождение паспорта. */
export const TRACKED_FIELDS = [
  "name",
  "brand",
  "manufacturerName",
  "category",
  "language",
  "gtin",
  "description",
  "usage",
  "ingredients",
  "attributes",
  "photos",
  "videoUrl",
  "documents",
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

/** Что именно изменилось: история пишется по полям, а не «паспорт правлен». */
export function diffProduct(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { field: TrackedField; before: unknown; after: unknown }[] {
  const out: { field: TrackedField; before: unknown; after: unknown }[] = [];
  for (const field of TRACKED_FIELDS) {
    const a = before[field] ?? null;
    const b = after[field] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field, before: a, after: b });
  }
  return out;
}
