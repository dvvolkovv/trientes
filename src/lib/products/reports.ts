import type { ProductReportReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureCase } from "@/lib/cases/ensure";
import { appendCaseEvent } from "@/lib/cases/journal";
import { raiseAndNotify } from "@/lib/cases/admin-notify";
import { PER_IP_COOLDOWN_SECONDS, reporterIpHash, tooSoon } from "@/lib/points/report-rules";
import { VISIBLE_PRODUCT } from "@/lib/products/read";

export const COMMENT_MAX = 1000;

const REASONS: ProductReportReason[] = ["WRONG_DATA", "FAKE", "NOT_MINE", "ILLEGAL", "OTHER"];

export type RejectReason = "not_found" | "bad_reason" | "comment_required" | "comment_too_long" | "too_soon";

export type NormalizedReport =
  | { ok: true; productId: string; reason: ProductReportReason; comment: string | null }
  | { ok: false; reason: Exclude<RejectReason, "too_soon"> };

/** Разбор входа отделён от базы: правила видны тестом без сервера (как у жалоб на точки). */
export function normalizeProductReportInput(input: {
  productId?: unknown;
  reason?: unknown;
  comment?: unknown;
}): NormalizedReport {
  const productId = typeof input.productId === "string" ? input.productId.trim() : "";
  if (!productId) return { ok: false, reason: "not_found" };

  const reason = REASONS.find((r) => r === input.reason);
  if (!reason) return { ok: false, reason: "bad_reason" };

  const raw = typeof input.comment === "string" ? input.comment.trim() : "";
  if (raw.length > COMMENT_MAX) return { ok: false, reason: "comment_too_long" };
  // «Неверные данные» и «другое» без слов — пустая строка в очереди: сотруднику не с чем
  // сверять паспорт.
  if ((reason === "OTHER" || reason === "WRONG_DATA") && raw.length === 0) {
    return { ok: false, reason: "comment_required" };
  }

  return { ok: true, productId, reason, comment: raw.length ? raw : null };
}

export type SubmitResult = { ok: true } | { ok: false; reason: RejectReason };

/**
 * Жалоба на паспорт товара. Дело заводится на первой же жалобе — второй некуда лечь;
 * заявителем дела считается хозяин паспорта, если он есть: с ним и ведётся разговор.
 * У паспорта без хозяина переписки нет, дело ведёт сотрудник сам.
 */
export async function submitProductReport(input: {
  productId: unknown;
  reason: unknown;
  comment?: unknown;
  ip: string;
  userId?: string | null;
}): Promise<SubmitResult> {
  const parsed = normalizeProductReportInput(input);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const product = await prisma.product.findFirst({
    where: { id: parsed.productId, ...VISIBLE_PRODUCT },
    select: { id: true, name: true, ownerCompany: { select: { ownerUserId: true } } },
  });
  if (!product) return { ok: false, reason: "not_found" };

  const ipHash = reporterIpHash(input.ip);
  const last = await prisma.productReport.findFirst({
    where: {
      productId: product.id,
      reporterIpHash: ipHash,
      createdAt: { gte: new Date(Date.now() - PER_IP_COOLDOWN_SECONDS * 1000) },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (tooSoon(last?.createdAt ?? null, new Date())) return { ok: false, reason: "too_soon" };

  await prisma.productReport.create({
    data: {
      productId: product.id,
      reporterUserId: input.userId ?? null,
      reporterIpHash: ipHash,
      reason: parsed.reason,
      comment: parsed.comment,
    },
  });

  // Сбой заведения дела жалобу не роняет — ровно как у подачи заявки.
  const caseId = await ensureCase({
    subjectType: "PRODUCT_REPORT",
    subjectId: product.id,
    title: `Reports: ${product.name}`,
    applicantUserId: product.ownerCompany?.ownerUserId ?? null,
  });
  if (!caseId) return { ok: true };

  await appendCaseEvent({
    caseId,
    kind: "PRODUCT_REPORTED",
    actorSide: "SYSTEM",
    payload: { reason: parsed.reason },
  });

  // Звоним один раз — на первой жалобе по делу: каждая следующая звонила бы по десять
  // раз за вечер, а дело уже в очереди.
  const total = await prisma.productReport.count({ where: { productId: product.id } });
  if (total === 1) {
    const staff = await prisma.user.findMany({
      where: {
        OR: [
          { role: { in: ["OWNER", "ADMIN"] } },
          {
            role: "STAFF",
            staffMember: { is: { revokedAt: null } },
            staffGrants: { some: { queue: "products" } },
          },
        ],
      },
      select: { id: true },
    });
    for (const s of staff) {
      await raiseAndNotify({
        userId: s.id,
        caseId,
        kind: "PRODUCT_REPORTED",
        title: `A product passport was reported: ${product.name}`,
      });
    }
  }

  return { ok: true };
}
