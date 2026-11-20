/**
 * Чтение переписки покупателя с магазином. Спека
 * `docs/superpowers/specs/2026-11-20-customer-messages-design.md`.
 *
 * Отозванное сообщение из выборки **не исключается**: строка остаётся в разговоре, а
 * текст на экране заменяется словами «сообщение отозвано» — иначе под ответом исчезал
 * бы вопрос, на который он отвечает (правило BP).
 */
import { prisma } from "@/lib/prisma";
import {
  CUSTOMER_PAGE,
  unansweredCount,
  unreadForSide,
  type CustomerSideKey,
} from "@/lib/customer-messages/rules";

export type CustomerMessageRow = {
  id: string;
  body: string;
  side: CustomerSideKey;
  createdAt: Date;
  /** Чьё это сообщение с точки зрения смотрящего. */
  mine: boolean;
  withdrawn: boolean;
  /** Имя сотрудника — только своим: покупателю магазин отвечает одним голосом (§ 2.3). */
  authorLabel: string | null;
  authorUserId: string | null;
};

export type ThreadView = {
  id: string;
  companyId: string;
  companyName: string;
  customerUserId: string;
  customerLabel: string;
  blockedAt: Date | null;
  blockReason: string | null;
  createdAt: Date;
  rows: CustomerMessageRow[];
  earlierBefore: Date | null;
};

const PERSON = { select: { id: true, username: true, name: true, email: true } } as const;

function label(u: { id: string; username: string | null; name: string | null; email: string | null } | null): string {
  if (!u) return "—";
  return u.username || u.name || u.email || u.id.slice(0, 8);
}

type RawMessage = {
  id: string;
  body: string;
  side: CustomerSideKey;
  createdAt: Date;
  deletedAt: Date | null;
  authorUserId: string | null;
  author: { id: string; username: string | null; name: string | null; email: string | null } | null;
};

function row(raw: RawMessage, viewerSide: CustomerSideKey): CustomerMessageRow {
  return {
    id: raw.id,
    body: raw.deletedAt ? "" : raw.body,
    side: raw.side,
    createdAt: raw.createdAt,
    mine: raw.side === viewerSide,
    withdrawn: Boolean(raw.deletedAt),
    // Имя сотрудника видно только внутри магазина — ответственность, а не лицо.
    authorLabel: viewerSide === "STORE" && raw.side === "STORE" ? label(raw.author) : null,
    authorUserId: raw.authorUserId,
  };
}

const MESSAGE_SELECT = {
  id: true,
  body: true,
  side: true,
  createdAt: true,
  deletedAt: true,
  authorUserId: true,
  author: PERSON,
} as const;

/**
 * Разговор страницами: берём последние `CUSTOMER_PAGE` до курсора и отдаём снизу вверх
 * по времени. Курсор — час сообщения, а не номер страницы (приём BP).
 */
export async function readThread(
  threadId: string,
  viewerSide: CustomerSideKey,
  opts: { before?: Date | null } = {},
): Promise<ThreadView | null> {
  const thread = await prisma.customerThread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      companyId: true,
      customerUserId: true,
      blockedAt: true,
      blockReason: true,
      createdAt: true,
      company: { select: { displayName: true, legalName: true } },
      customer: PERSON,
    },
  });
  if (!thread) return null;

  const raws = (await prisma.customerMessage.findMany({
    where: { threadId, ...(opts.before ? { createdAt: { lt: opts.before } } : {}) },
    orderBy: { createdAt: "desc" },
    take: CUSTOMER_PAGE + 1,
    select: MESSAGE_SELECT,
  })) as RawMessage[];

  const hasMore = raws.length > CUSTOMER_PAGE;
  const page = raws.slice(0, CUSTOMER_PAGE).reverse();
  return {
    id: thread.id,
    companyId: thread.companyId,
    companyName: thread.company.displayName || thread.company.legalName,
    customerUserId: thread.customerUserId,
    customerLabel: label(thread.customer),
    blockedAt: thread.blockedAt,
    blockReason: thread.blockReason,
    createdAt: thread.createdAt,
    rows: page.map((raw) => row(raw, viewerSide)),
    earlierBefore: hasMore ? page[0]?.createdAt ?? null : null,
  };
}

/** Строки, пришедшие после известной: опрос раз в 15 с (приём BP). */
export async function readThreadSince(
  threadId: string,
  viewerSide: CustomerSideKey,
  after: Date,
): Promise<CustomerMessageRow[]> {
  const raws = (await prisma.customerMessage.findMany({
    where: { threadId, createdAt: { gt: after } },
    orderBy: { createdAt: "asc" },
    take: CUSTOMER_PAGE,
    select: MESSAGE_SELECT,
  })) as RawMessage[];
  return raws.map((raw) => row(raw, viewerSide));
}

export type ThreadListRow = {
  id: string;
  title: string;
  lastMessageAt: Date;
  lastBody: string;
  unread: number;
  blocked: boolean;
};

const LIST_MESSAGES = {
  select: { side: true, createdAt: true, deletedAt: true, body: true },
  orderBy: { createdAt: "desc" as const },
  take: 200,
} as const;

type ListRaw = {
  id: string;
  lastMessageAt: Date;
  blockedAt: Date | null;
  customerReadAt: Date | null;
  storeReadAt: Date | null;
  messages: { side: CustomerSideKey; createdAt: Date; deletedAt: Date | null; body: string }[];
};

function listRow(raw: ListRaw, side: CustomerSideKey, title: string): ThreadListRow {
  const lastReadAt = side === "STORE" ? raw.storeReadAt : raw.customerReadAt;
  const latest = raw.messages.find((m) => !m.deletedAt);
  return {
    id: raw.id,
    title,
    lastMessageAt: raw.lastMessageAt,
    lastBody: latest ? latest.body.slice(0, 160) : "",
    unread: unreadForSide(raw.messages, side, lastReadAt),
    blocked: Boolean(raw.blockedAt),
  };
}

/** Лента магазина: нитки по убыванию последнего сообщения. */
export async function readStoreThreads(companyId: string): Promise<ThreadListRow[]> {
  const raws = await prisma.customerThread.findMany({
    where: { companyId },
    orderBy: { lastMessageAt: "desc" },
    take: 200,
    select: {
      id: true,
      lastMessageAt: true,
      blockedAt: true,
      customerReadAt: true,
      storeReadAt: true,
      customer: PERSON,
      messages: LIST_MESSAGES,
    },
  });
  return raws.map((raw) => listRow(raw as unknown as ListRaw, "STORE", label(raw.customer)));
}

/** Нитки покупателя: по одному магазину одна (§ 2.2). */
export async function readCustomerThreads(userId: string): Promise<ThreadListRow[]> {
  const raws = await prisma.customerThread.findMany({
    where: { customerUserId: userId },
    orderBy: { lastMessageAt: "desc" },
    take: 200,
    select: {
      id: true,
      lastMessageAt: true,
      blockedAt: true,
      customerReadAt: true,
      storeReadAt: true,
      company: { select: { displayName: true, legalName: true } },
      messages: LIST_MESSAGES,
    },
  });
  return raws.map((raw) =>
    listRow(raw as unknown as ListRaw, "CUSTOMER", raw.company.displayName || raw.company.legalName),
  );
}

/** Непрочитанное магазина целиком — число на плитке кабинета. */
export async function storeUnreadTotal(companyId: string): Promise<number> {
  const rows = await readStoreThreads(companyId);
  return rows.reduce((sum, r) => sum + r.unread, 0);
}

/** Непрочитанное покупателя целиком — число в разделе кабинета. */
export async function customerUnreadTotal(userId: string): Promise<number> {
  const rows = await readCustomerThreads(userId);
  return rows.reduce((sum, r) => sum + r.unread, 0);
}

/**
 * Сколько сообщений покупатель послал за сутки по всем магазинам и сколько своих
 * подряд без ответа в этой нитке — два числа антиспама (§ 2.6), оба до записи.
 */
export async function customerLoad(
  userId: string,
  threadId: string | null,
): Promise<{ todayCount: number; unanswered: number }> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const [todayCount, tail] = await Promise.all([
    prisma.customerMessage.count({
      where: {
        side: "CUSTOMER",
        authorUserId: userId,
        createdAt: { gte: startOfDay },
      },
    }),
    threadId
      ? prisma.customerMessage.findMany({
          where: { threadId },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { side: true },
        })
      : Promise.resolve([] as { side: CustomerSideKey }[]),
  ]);
  return { todayCount, unanswered: unansweredCount(tail as { side: CustomerSideKey }[]) };
}
