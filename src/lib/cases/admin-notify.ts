import type { AdminNotificationKind, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";

const SITE_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

/** Текст сотруднику — по-английски, как во всех существующих вызовах notifyUser. */
const TELEGRAM_LINE: Record<AdminNotificationKind, string> = {
  APPLICANT_REPLIED: "💬 Applicant replied",
  DUE_SOON: "⏰ Case due within 24 hours",
  CASE_OVERDUE: "🔴 Case overdue",
  APPLICANT_SILENT: "🕸 Applicant silent for 14 days",
  POINT_REPORTED: "🚩 New report on a map point",
  REVIEW_DUE: "🗓 Periodic review due",
  ACCESS_REVIEW_DUE: "🔑 Staff access review due",
};

export type RaiseInput = {
  userId: string;
  kind: AdminNotificationKind;
  caseId: string;
  /** Снимок названия дела: список должен читаться, даже если дело удалили. */
  title: string;
  body?: string | null;
  /** Дубль в Telegram/почту. Для прогона сроков — да, для каждой реплики — да. */
  alsoNotify?: boolean;
};

/**
 * Один звонок на (сотрудник, повод, дело), пока он не прочитан: пять ответов
 * заявителя подряд не должны давать пять колокольчиков. Прочитанный звонок
 * тем же поводом может прозвенеть заново — это новое событие.
 */
export async function raiseAdminNotification(
  db: Pick<PrismaClient, "adminNotification">,
  input: RaiseInput,
): Promise<"created" | "collapsed"> {
  const existing = await db.adminNotification.findFirst({
    where: { userId: input.userId, kind: input.kind, caseId: input.caseId, readAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    await db.adminNotification.update({
      where: { id: existing.id },
      data: { title: input.title.slice(0, 200), body: input.body?.slice(0, 400) ?? null, createdAt: new Date() },
    });
    return "collapsed";
  }

  await db.adminNotification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      caseId: input.caseId,
      title: input.title.slice(0, 200),
      body: input.body?.slice(0, 400) ?? null,
    },
  });
  return "created";
}

/** Колокольчик плюс дубль в Telegram/почту. Сбой канала звонок не отменяет. */
export async function raiseAndNotify(input: RaiseInput): Promise<void> {
  const state = await raiseAdminNotification(prisma, input).catch((err) => {
    console.error("[case-notify] failed to raise:", err);
    return null;
  });
  // Схлопнутый звонок второй раз в Telegram не шлём: это то же событие.
  if (state !== "created" || input.alsoNotify === false) return;
  const url = `${SITE_ORIGIN}/en/admin/cases/${input.caseId}`;
  void notifyUser({
    userId: input.userId,
    subject: `${TELEGRAM_LINE[input.kind]}: ${input.title}`,
    text: `${TELEGRAM_LINE[input.kind]}\n${input.title}\n${url}`,
    url,
  }).catch(() => {});
}
