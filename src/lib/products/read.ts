/**
 * Чтение паспортов товара: каталог, страница, список предприятия. Правило видимости —
 * в одном месте (`VISIBLE_PRODUCT`), как `PUBLIC_COMPANY` у предприятий: своя копия
 * правила в проекте уже однажды отставала.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseGtin } from "@/lib/products/gtin";
import { isProductCategory } from "@/lib/products/categories";

/** Паспорт, который показываем снаружи: не снят надзором, не удалён, не признан дублем. */
export const VISIBLE_PRODUCT = { suspendedAt: null, deletedAt: null, mergedIntoId: null } as const;

export const PRODUCT_PAGE_SIZE = 24;

export type CatalogCard = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  category: string;
  gtin: string | null;
  photoUrl: string | null;
  hasVideo: boolean;
  ownerName: string | null;
};

type PhotoRow = { url?: unknown; label?: unknown };

/** Первое годное фото паспорта: адреса приходят из нашей же загрузки, но проверяем. */
export function firstPhotoUrl(photos: unknown): string | null {
  if (!Array.isArray(photos)) return null;
  for (const row of photos as PhotoRow[]) {
    const url = row && typeof row === "object" ? row.url : null;
    if (typeof url === "string" && url.startsWith("/uploads/")) return url;
  }
  return null;
}

export async function readCatalog(opts: {
  q?: string;
  category?: string;
  page?: number;
}): Promise<{ rows: CatalogCard[]; total: number; page: number; pages: number }> {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const q = (opts.q ?? "").trim();
  const where: Prisma.ProductWhereInput = { ...VISIBLE_PRODUCT };
  if (opts.category && isProductCategory(opts.category)) where.category = opts.category;
  if (q) {
    // Набранное может быть штрихкодом: тогда ищем точно по нему, а не подстрокой — у
    // кода нет «похожих», и частичное совпадение показало бы чужой товар.
    const gtin = parseGtin(q);
    where.OR = gtin
      ? [{ gtin }]
      : [
          { name: { contains: q, mode: "insensitive" } },
          { brand: { contains: q, mode: "insensitive" } },
          { manufacturerName: { contains: q, mode: "insensitive" } },
        ];
  }

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * PRODUCT_PAGE_SIZE,
      take: PRODUCT_PAGE_SIZE,
      select: {
        id: true,
        slug: true,
        name: true,
        brand: true,
        category: true,
        gtin: true,
        photos: true,
        videoUrl: true,
        ownerCompany: { select: { displayName: true, status: true, suspendedAt: true, deletedAt: true } },
      },
    }),
  ]);

  return {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PRODUCT_PAGE_SIZE)),
    rows: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      brand: r.brand,
      category: r.category,
      gtin: r.gtin,
      photoUrl: firstPhotoUrl(r.photos),
      hasVideo: Boolean(r.videoUrl),
      // Производителя называем только живого: снятое надзором предприятие не светится
      // нигде, и паспорт — не исключение.
      ownerName:
        r.ownerCompany && r.ownerCompany.status === "APPROVED" && !r.ownerCompany.suspendedAt && !r.ownerCompany.deletedAt
          ? r.ownerCompany.displayName
          : null,
    })),
  };
}

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof readProductBySlug>>>;

/**
 * Паспорт по адресу. Удалённый не отдаётся вовсе; снятый надзором отдаётся со своей
 * пометкой (страница сама решает, что показать), а слитый — чтобы страница отправила
 * на главный паспорт 308-м.
 */
export async function readProductBySlug(slug: string) {
  const product = await prisma.product.findFirst({
    where: { slug, deletedAt: null },
    select: {
      id: true,
      slug: true,
      gtin: true,
      name: true,
      brand: true,
      manufacturerName: true,
      category: true,
      language: true,
      description: true,
      usage: true,
      ingredients: true,
      attributes: true,
      photos: true,
      videoUrl: true,
      documents: true,
      ownerCompanyId: true,
      suspendedAt: true,
      mergedIntoId: true,
      tokenChain: true,
      tokenAsset: true,
      createdAt: true,
      updatedAt: true,
      mergedInto: { select: { slug: true } },
      ownerCompany: {
        select: { id: true, displayName: true, logoUrl: true, status: true, suspendedAt: true, deletedAt: true },
      },
    },
  });
  if (!product) return null;
  const owner =
    product.ownerCompany &&
    product.ownerCompany.status === "APPROVED" &&
    !product.ownerCompany.suspendedAt &&
    !product.ownerCompany.deletedAt
      ? product.ownerCompany
      : null;
  return { ...product, owner };
}

export async function readProductById(id: string) {
  return prisma.product.findFirst({ where: { id, deletedAt: null } });
}

/** Паспорта, к которым предприятие прикасалось: свои заведённые и свои правленные. */
export async function readCompanyProducts(companyId: string, take = 100) {
  const touched = await prisma.productEdit.findMany({
    where: { companyId },
    distinct: ["productId"],
    orderBy: { createdAt: "desc" },
    select: { productId: true },
    take,
  });
  const ids = new Set<string>(touched.map((t) => t.productId));
  const rows = await prisma.product.findMany({
    where: {
      deletedAt: null,
      OR: [{ createdByCompanyId: companyId }, { ownerCompanyId: companyId }, { id: { in: [...ids] } }],
    },
    orderBy: { updatedAt: "desc" },
    take,
    select: {
      id: true,
      slug: true,
      name: true,
      brand: true,
      category: true,
      gtin: true,
      photos: true,
      ownerCompanyId: true,
      suspendedAt: true,
      mergedIntoId: true,
      updatedAt: true,
    },
  });
  return rows.map((r) => ({ ...r, photoUrl: firstPhotoUrl(r.photos) }));
}

/** История правок паспорта — читается рассказом, поэтому с автором и предприятием. */
export async function readProductHistory(productId: string, take = 50) {
  return prisma.productEdit.findMany({
    where: { productId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      field: true,
      before: true,
      after: true,
      revertOfId: true,
      createdAt: true,
      company: { select: { id: true, displayName: true } },
      user: { select: { id: true, username: true, name: true } },
    },
  });
}

/** Предложения правок, ждущие хозяина паспорта. */
export async function readPendingRevisions(productId: string) {
  return prisma.productRevision.findMany({
    where: { productId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      patch: true,
      createdAt: true,
      company: { select: { id: true, displayName: true } },
      user: { select: { id: true, username: true, name: true } },
    },
  });
}
