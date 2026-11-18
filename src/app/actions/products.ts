"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ensureCase } from "@/lib/cases/ensure";
import { slugCandidates, slugify } from "@/lib/slugify";
import { parseGtin } from "@/lib/products/gtin";
import {
  DAILY_EDITS,
  DAILY_PRODUCTS,
  editKind,
  revertPatch,
  withinDailyLimit,
  type EditorCompany,
} from "@/lib/products/rules";
import { TRACKED_FIELDS, diffProduct, validateProductInput, type ProductInput, type TrackedField } from "@/lib/products/validate";

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

/**
 * Предприятие глазами правила правки: статус, надзор, удаление и роль в нём того, кто
 * нажал. Читается из базы на каждом вызове — снятое надзором предприятие перестаёт
 * править паспорта тем же сеансом, без перезахода.
 */
async function editorCompany(companyId: string, userId: string): Promise<EditorCompany | null> {
  const [company, member] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, status: true, suspendedAt: true, deletedAt: true },
    }),
    prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId } },
      select: { role: true },
    }),
  ]);
  if (!company || !member) return null;
  return {
    id: company.id,
    status: company.status,
    suspendedAt: company.suspendedAt,
    deletedAt: company.deletedAt,
    role: member.role,
  };
}

function dayAgo(): Date {
  return new Date(Date.now() - 86_400_000);
}

async function freeSlug(name: string): Promise<string> {
  const base = slugify(name, "product");
  for (const candidate of slugCandidates(base, 6)) {
    const taken = await prisma.product.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Паспорт по штрихкоду: форма заведения сначала спрашивает код, чтобы не плодить дубли. */
export async function findProductByGtin(raw: string) {
  const gtin = parseGtin(raw);
  if (!gtin) return { ok: false as const, reason: "gtin_invalid" as const };
  const product = await prisma.product.findFirst({
    where: { gtin, deletedAt: null },
    select: { id: true, slug: true, name: true, ownerCompanyId: true },
  });
  return { ok: true as const, product: product ?? null };
}

export async function createProduct(companyId: string, input: ProductInput) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const company = await editorCompany(companyId, userId);
  // У нового паспорта хозяина нет по определению — правило то же, что у правки.
  if (editKind({ ownerCompanyId: null, suspendedAt: null, mergedIntoId: null, deletedAt: null }, company) === "forbidden") {
    return fail("forbidden");
  }

  const v = validateProductInput(input);
  if (!v.ok) return fail(v.reason);

  const madeToday = await prisma.product.count({
    where: { createdByCompanyId: companyId, createdAt: { gte: dayAgo() } },
  });
  if (!withinDailyLimit(madeToday, DAILY_PRODUCTS)) return fail("daily_limit");

  if (v.data.gtin) {
    const taken = await prisma.product.findFirst({
      where: { gtin: v.data.gtin, deletedAt: null },
      select: { slug: true },
    });
    // Склейка по штрихкоду и есть смысл кода: второй продавец идёт в существующий
    // паспорт, а не заводит второй.
    if (taken) return { ok: false as const, reason: "gtin_taken" as const, slug: taken.slug };
  }

  const slug = await freeSlug(v.data.name);
  const product = await prisma.product.create({
    data: {
      slug,
      createdByCompanyId: companyId,
      name: v.data.name,
      brand: v.data.brand,
      manufacturerName: v.data.manufacturerName,
      category: v.data.category,
      language: v.data.language,
      gtin: v.data.gtin,
      description: v.data.description,
      usage: v.data.usage,
      ingredients: v.data.ingredients,
      attributes: v.data.attributes,
      photos: v.data.photos,
      videoUrl: v.data.videoUrl,
      documents: v.data.documents,
    },
    select: { id: true, slug: true },
  });

  await prisma.productEdit.create({
    data: { productId: product.id, companyId, userId, field: "created", after: { name: v.data.name } },
  });

  revalidatePath("/[locale]/products", "page");
  return { ok: true as const, id: product.id, slug: product.slug };
}

/**
 * Правка. У паспорта без хозяина пишется сразу; у паспорта с хозяином чужая правка
 * становится предложением (`ProductRevision`) — решает хозяин, а не администратор
 * платформы: это спор двух предприятий о свойствах их товара.
 */
export async function updateProduct(companyId: string, productId: string, input: ProductInput) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const [company, product] = await Promise.all([
    editorCompany(companyId, userId),
    prisma.product.findUnique({ where: { id: productId } }),
  ]);
  if (!product) return fail("not_found");
  const kind = editKind(product, company);
  if (kind === "forbidden") return fail("forbidden");

  const v = validateProductInput(input);
  if (!v.ok) return fail(v.reason);

  if (v.data.gtin && v.data.gtin !== product.gtin) {
    const taken = await prisma.product.findFirst({
      where: { gtin: v.data.gtin, deletedAt: null, id: { not: productId } },
      select: { slug: true },
    });
    if (taken) return { ok: false as const, reason: "gtin_taken" as const, slug: taken.slug };
  }

  const changes = diffProduct(product as unknown as Record<string, unknown>, v.data as unknown as Record<string, unknown>);
  if (changes.length === 0) return { ok: true as const, changed: 0, kind };

  if (kind === "revision") {
    const revision = await prisma.productRevision.create({
      data: {
        productId,
        companyId,
        userId,
        patch: changes.map((c) => ({ field: c.field, after: c.after })) as never,
      },
      select: { id: true },
    });
    return { ok: true as const, changed: changes.length, kind, revisionId: revision.id };
  }

  const editsToday = await prisma.productEdit.count({
    where: { companyId, createdAt: { gte: dayAgo() } },
  });
  if (!withinDailyLimit(editsToday, DAILY_EDITS)) return fail("daily_limit");

  await applyFields(productId, companyId, userId, changes, null);
  revalidatePath(`/[locale]/product/${product.slug}`, "page");
  return { ok: true as const, changed: changes.length, kind };
}

/** Запись полей и истории одной транзакцией: правка без записи в историю — это потеря автора. */
async function applyFields(
  productId: string,
  companyId: string | null,
  userId: string | null,
  changes: { field: TrackedField | string; before?: unknown; after: unknown }[],
  revertOfId: string | null,
) {
  const data: Record<string, unknown> = {};
  for (const c of changes) {
    if (!(TRACKED_FIELDS as readonly string[]).includes(c.field)) continue;
    data[c.field] = c.after ?? null;
  }
  await prisma.$transaction([
    prisma.product.update({ where: { id: productId }, data }),
    prisma.productEdit.createMany({
      data: changes.map((c) => ({
        productId,
        companyId,
        userId,
        field: String(c.field),
        before: (c.before ?? null) as never,
        after: (c.after ?? null) as never,
        revertOfId,
      })),
    }),
  ]);
}

/** Откат правки — новая запись истории «вернуть как было», а не удаление прежней. */
export async function revertProductEdit(companyId: string, editId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const edit = await prisma.productEdit.findUnique({
    where: { id: editId },
    select: { id: true, productId: true, field: true, before: true, after: true },
  });
  if (!edit) return fail("not_found");
  if (!(TRACKED_FIELDS as readonly string[]).includes(edit.field)) return fail("not_revertable");

  const [company, product] = await Promise.all([
    editorCompany(companyId, userId),
    prisma.product.findUnique({ where: { id: edit.productId } }),
  ]);
  if (!product) return fail("not_found");
  if (editKind(product, company) !== "direct") return fail("forbidden");

  const patch = revertPatch(edit);
  await applyFields(edit.productId, companyId, userId, [{ field: patch.field, before: edit.after, after: patch.after }], edit.id);
  revalidatePath(`/[locale]/product/${product.slug}`, "page");
  return { ok: true as const };
}

/** Заявка производителя на владение паспортом: дело в очереди `products`. */
export async function submitProductClaim(companyId: string, productId: string, evidence: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const company = await editorCompany(companyId, userId);
  if (!company || company.status !== "APPROVED" || company.suspendedAt || company.deletedAt) return fail("forbidden");
  if (company.role === "VIEWER") return fail("forbidden");

  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!product) return fail("not_found");
  if (product.ownerCompanyId) return fail("already_owned");

  const text = (evidence ?? "").trim();
  if (text.length < 10) return fail("evidence_required");

  const pending = await prisma.productClaim.findFirst({
    where: { productId, status: "PENDING" },
    select: { id: true, companyId: true },
  });
  if (pending) return fail(pending.companyId === companyId ? "already_pending" : "claim_pending");

  const claim = await prisma.productClaim.create({
    data: { productId, companyId, userId, evidence: text },
    select: { id: true },
  });
  await ensureCase({
    subjectType: "PRODUCT_CLAIM",
    subjectId: claim.id,
    title: `${product.name} — ${company.id}`,
    applicantUserId: userId,
  });
  return { ok: true as const, id: claim.id };
}

/** Решение по предложению правки принимает хозяин паспорта. */
export async function decideRevision(companyId: string, revisionId: string, accept: boolean, reason?: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const revision = await prisma.productRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, productId: true, status: true, patch: true },
  });
  if (!revision) return fail("not_found");
  if (revision.status !== "PENDING") return fail("not_pending");

  const [company, product] = await Promise.all([
    editorCompany(companyId, userId),
    prisma.product.findUnique({ where: { id: revision.productId } }),
  ]);
  if (!product) return fail("not_found");
  // Решает только хозяин: у паспорта без хозяина предложений не бывает.
  if (product.ownerCompanyId !== companyId) return fail("forbidden");
  if (editKind(product, company) !== "direct") return fail("forbidden");

  if (!accept) {
    const note = (reason ?? "").trim();
    if (note.length < 3) return fail("reason_required");
    await prisma.productRevision.update({
      where: { id: revisionId },
      data: { status: "REJECTED", decidedById: userId, decidedAt: new Date(), reason: note },
    });
    return { ok: true as const, applied: 0 };
  }

  const patch = Array.isArray(revision.patch) ? (revision.patch as { field: string; after: unknown }[]) : [];
  const changes = patch
    .filter((p) => (TRACKED_FIELDS as readonly string[]).includes(p.field))
    .map((p) => ({ field: p.field, before: (product as unknown as Record<string, unknown>)[p.field] ?? null, after: p.after }));
  if (changes.length === 0) return fail("empty_patch");

  await applyFields(revision.productId, companyId, userId, changes, null);
  await prisma.productRevision.update({
    where: { id: revisionId },
    data: { status: "ACCEPTED", decidedById: userId, decidedAt: new Date() },
  });
  revalidatePath(`/[locale]/product/${product.slug}`, "page");
  return { ok: true as const, applied: changes.length };
}

/** Автор может забрать своё предложение, пока хозяин не ответил. */
export async function withdrawRevision(companyId: string, revisionId: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const revision = await prisma.productRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, companyId: true, status: true },
  });
  if (!revision) return fail("not_found");
  if (revision.companyId !== companyId) return fail("forbidden");
  if (revision.status !== "PENDING") return fail("not_pending");
  const company = await editorCompany(companyId, userId);
  if (!company || company.role === "VIEWER") return fail("forbidden");

  await prisma.productRevision.update({
    where: { id: revisionId },
    data: { status: "WITHDRAWN", decidedAt: new Date() },
  });
  return { ok: true as const };
}
