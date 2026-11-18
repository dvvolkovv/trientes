/**
 * Правила паспорта товара — чистые, без Prisma: по ним решается, кто правит паспорт,
 * готов ли он к токенизации и что принимается в поля. Спека
 * `docs/superpowers/specs/2026-11-18-product-passport-catalog-design.md`, разделы 4, 6, 7.
 */

export const MAX_PHOTOS = 8;
export const MAX_ATTRS = 50;
export const MAX_DOCS = 10;
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
export const MAX_DOC_BYTES = 10 * 1024 * 1024;
/** Новых паспортов в сутки на предприятие и правок в сутки на предприятие. */
export const DAILY_PRODUCTS = 50;
export const DAILY_EDITS = 200;
/** Описание короче — паспорт к токенизации не готов: токенизируют вещь, а не заголовок. */
export const READY_DESCRIPTION_CHARS = 120;

export type ProductGate = {
  ownerCompanyId: string | null;
  suspendedAt: Date | null;
  mergedIntoId: string | null;
  deletedAt: Date | null;
};

export type EditorCompany = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  suspendedAt: Date | null;
  deletedAt: Date | null;
  role: "OWNER" | "EDITOR" | "VIEWER";
};

/**
 * `direct` — правка пишется сразу; `revision` — становится предложением правки хозяину;
 * `forbidden` — не правит вовсе.
 */
export type EditKind = "direct" | "revision" | "forbidden";

export function editKind(product: ProductGate, company: EditorCompany | null): EditKind {
  if (!company) return "forbidden";
  // Правит только предприятие, прошедшее нашу модерацию и не снятое надзором: это и есть
  // защита паспорта вместо очереди на каждую правку.
  if (company.status !== "APPROVED") return "forbidden";
  if (company.suspendedAt || company.deletedAt) return "forbidden";
  if (company.role === "VIEWER") return "forbidden";
  // Снятый надзором возвращает сотрудник, а не правка автора; у слитого правят главный.
  if (product.suspendedAt || product.mergedIntoId || product.deletedAt) return "forbidden";
  if (!product.ownerCompanyId) return "direct";
  return product.ownerCompanyId === company.id ? "direct" : "revision";
}

export function canEditProduct(product: ProductGate, company: EditorCompany | null): boolean {
  return editKind(product, company) !== "forbidden";
}

export type ReadinessInput = {
  name: string;
  category: string;
  description: string;
  photoCount: number;
  documentCount: number;
  gtin: string | null;
  ownerCompanyId: string | null;
};

export type ReadinessMissing = "name" | "category" | "description" | "photo" | "gtin" | "manufacturer" | "document";

/**
 * Готовность к токенизации — наш проверяемый факт, а не обещание. Раздел не называется
 * «токенизированная продукция»: токен выпускает сеть, и пока его нет, сайт говорит ровно
 * то, что знает — чего паспорту не хватает.
 */
export function tokenizationReadiness(input: ReadinessInput): { ready: boolean; missing: ReadinessMissing[] } {
  const missing: ReadinessMissing[] = [];
  if (!input.name.trim()) missing.push("name");
  if (!input.category.trim()) missing.push("category");
  if (input.description.trim().length < READY_DESCRIPTION_CHARS) missing.push("description");
  if (input.photoCount < 1) missing.push("photo");
  if (!input.gtin) missing.push("gtin");
  if (!input.ownerCompanyId) missing.push("manufacturer");
  if (input.documentCount < 1) missing.push("document");
  return { ready: missing.length === 0, missing };
}

/**
 * Файл читается по содержимому, а не по заявленному типу: видео отдаёт nginx без всякой
 * проверки, и `Content-Type` формы — слово загружающего. У mp4 на смещении 4 стоит `ftyp`.
 */
export function isMp4(head: Uint8Array): boolean {
  if (head.length < 12) return false;
  return String.fromCharCode(head[4], head[5], head[6], head[7]) === "ftyp";
}

export type ProductEditEntry = { field: string; before: unknown; after: unknown };

/** Откат — это новая правка «вернуть как было», а не удаление записи истории. */
export function revertPatch(edit: ProductEditEntry): { field: string; after: unknown } {
  return { field: edit.field, after: edit.before ?? null };
}

export type ProductAttribute = { key: string; value: string; unit?: string };

/**
 * Свойства — свободные пары, а не колонки: у кабеля и у сыра общих колонок не бывает.
 * Пустая строка в списке — не свойство, а недонабранная строка формы.
 */
export function cleanAttributes(raw: unknown): ProductAttribute[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductAttribute[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const key = typeof r.key === "string" ? r.key.trim() : "";
    const value = typeof r.value === "string" ? r.value.trim() : "";
    const unit = typeof r.unit === "string" ? r.unit.trim() : "";
    if (!key || !value) continue;
    out.push(unit ? { key, value, unit } : { key, value });
    if (out.length >= MAX_ATTRS) break;
  }
  return out;
}

/** Уже записанное за сутки считается до работы — как в ограничителях входа. */
export function withinDailyLimit(already: number, max: number): boolean {
  return already < max;
}
