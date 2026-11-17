import type { PointReportReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PUBLIC_COMPANY } from "@/lib/company-visibility";
import { ensureCase } from "@/lib/cases/ensure";
import { appendCaseEvent } from "@/lib/cases/journal";
import { raiseAndNotify } from "@/lib/cases/admin-notify";
import { PER_IP_COOLDOWN_SECONDS, reporterIpHash, tooSoon } from "./report-rules";

export const COMMENT_MAX = 1000;

const REASONS: PointReportReason[] = ["CLOSED", "NO_CRYPTO", "WRONG_ADDRESS", "OTHER"];

export type RejectReason =
  | "not_found"
  | "bad_reason"
  | "comment_required"
  | "comment_too_long"
  | "too_soon";

export type NormalizedReport =
  | { ok: true; pointId: string; reason: PointReportReason; comment: string | null }
  | { ok: false; reason: Exclude<RejectReason, "too_soon"> };

/** Разбор входа отделён от базы: правила видны тестом без сервера. */
export function normalizeReportInput(input: {
  pointId?: unknown;
  reason?: unknown;
  comment?: unknown;
}): NormalizedReport {
  const pointId = typeof input.pointId === "string" ? input.pointId.trim() : "";
  if (!pointId) return { ok: false, reason: "not_found" };

  const reason = REASONS.find((r) => r === input.reason);
  if (!reason) return { ok: false, reason: "bad_reason" };

  const raw = typeof input.comment === "string" ? input.comment.trim() : "";
  if (raw.length > COMMENT_MAX) return { ok: false, reason: "comment_too_long" };
  // «Другое» без слов — пустая строка в очереди: причины нет, текста нет.
  if (reason === "OTHER" && raw.length === 0) return { ok: false, reason: "comment_required" };

  return { ok: true, pointId, reason, comment: raw.length ? raw : null };
}

export type SubmitResult = { ok: true } | { ok: false; reason: RejectReason };

/**
 * Жалоба принимается только на нашу точку: у точки зеркала BTC Map нет ни
 * владельца, которому писать, ни способа её снять — ночной синк вернёт её.
 */
export async function submitPointReport(input: {
  pointId: unknown;
  reason: unknown;
  comment?: unknown;
  ip: string;
  userId?: string | null;
}): Promise<SubmitResult> {
  const parsed = normalizeReportInput(input);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const point = await prisma.companyPoint.findFirst({
    where: {
      id: parsed.pointId,
      status: "APPROVED",
      deletedAt: null,
      company: PUBLIC_COMPANY,
    },
    include: { company: { select: { ownerUserId: true, displayName: true } } },
  });
  if (!point) return { ok: false, reason: "not_found" };

  const ipHash = reporterIpHash(input.ip);
  const last = await prisma.pointReport.findFirst({
    where: {
      pointId: point.id,
      reporterIpHash: ipHash,
      createdAt: { gte: new Date(Date.now() - PER_IP_COOLDOWN_SECONDS * 1000) },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (tooSoon(last?.createdAt ?? null, new Date())) return { ok: false, reason: "too_soon" };

  await prisma.pointReport.create({
    data: {
      pointId: point.id,
      reporterUserId: input.userId ?? null,
      reporterIpHash: ipHash,
      reason: parsed.reason,
      comment: parsed.comment,
    },
  });

  // Дело на точку заводится при первой же жалобе: иначе второй жалобе некуда
  // лечь. Сбой заведения дела жалобу не роняет — ровно как у подачи заявки.
  const caseId = await ensureCase({
    subjectType: "POINT_REPORT",
    subjectId: point.id,
    title: `Reports: ${point.name}`,
    applicantUserId: point.company?.ownerUserId ?? null,
  });
  if (!caseId) return { ok: true };

  await appendCaseEvent({
    caseId,
    kind: "POINT_REPORTED",
    actorSide: "SYSTEM",
    payload: { reason: parsed.reason },
  });

  // Звоним один раз — на первой жалобе по делу. Каждая следующая звонила бы по
  // десять раз за вечер, а делать с одной жалобой всё равно нечего: пороги
  // считает ежедневный прогон.
  const total = await prisma.pointReport.count({ where: { pointId: point.id } });
  if (total === 1) {
    // Звоним тем, кто эту очередь действительно видит: владельцам и
    // сотрудникам с правом на жалобы или на точки. Прежде звонок уходил всем
    // `ADMIN` — другого понятия доступа в проекте не было.
    const admins = await prisma.user.findMany({
      where: {
        OR: [
          { role: { in: ["OWNER", "ADMIN"] } },
          {
            role: "STAFF",
            staffMember: { is: { revokedAt: null } },
            staffGrants: { some: { queue: { in: ["pointReports", "points"] } } },
          },
        ],
      },
      select: { id: true },
    });
    for (const a of admins) {
      await raiseAndNotify({
        userId: a.id,
        kind: "POINT_REPORTED",
        caseId,
        title: `Reports: ${point.name}`,
      });
    }
  }
  return { ok: true };
}
