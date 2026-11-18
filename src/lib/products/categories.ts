/**
 * Категории товаров — ключи, проза в переводах (`products.category.*`). Список в коде, а
 * не в базе: по нему строится фильтр каталога, и новая категория приходит с переводом
 * во все локали, а не пустой строкой на экране.
 */
export const PRODUCT_CATEGORIES = [
  "food",
  "drinks",
  "electronics",
  "clothing",
  "home",
  "beauty",
  "health",
  "auto",
  "industrial",
  "materials",
  "agriculture",
  "services",
  "other",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export function isProductCategory(v: unknown): v is ProductCategory {
  return typeof v === "string" && (PRODUCT_CATEGORIES as readonly string[]).includes(v);
}
