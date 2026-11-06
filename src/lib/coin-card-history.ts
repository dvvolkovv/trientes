import { prisma } from "@/lib/prisma";
import type { DiffEntry } from "@/lib/coin-card-diff";

export type HistoryItem =
  | {
      kind: "revision";
      id: string;
      at: string;
      section: string | null;
      isPolicy: boolean;
      author: string;
      diff: DiffEntry[];
    }
  | {
      kind: "admin";
      id: string;
      at: string;
      action: "FORCE_COIN_REVISION" | "DISABLE_COIN_MULTISIG" | "TRANSFER_COIN_CARD";
      reason: string | null;
    };

/**
 * The public audit trail of a card: applied revisions plus the admin's
 * emergency actions. Both halves are shown, so an override is never silent.
 */
export async function getPublicCardHistory(
  cardId: string,
  limit = 30,
): Promise<HistoryItem[]> {
  const [revisions, overrides] = await Promise.all([
    prisma.coinCardRevision.findMany({
      where: { cardId, status: "APPLIED" },
      orderBy: { appliedAt: "desc" },
      take: limit,
      select: {
        id: true, section: true, kind: true, appliedAt: true, createdAt: true,
        author: { select: { username: true, name: true } },
        diff: true,
      },
    }),
    prisma.adminAuditLog.findMany({
      where: {
        targetId: cardId,
        action: { in: ["FORCE_COIN_REVISION", "DISABLE_COIN_MULTISIG", "TRANSFER_COIN_CARD"] },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, action: true, createdAt: true, details: true },
    }),
  ]);

  const items: HistoryItem[] = [
    ...revisions.map((r) => ({
      kind: "revision" as const,
      id: r.id,
      at: (r.appliedAt ?? r.createdAt).toISOString(),
      section: r.section,
      isPolicy: r.kind === "POLICY",
      // A handle, never an email — the team roster itself stays private.
      author: r.author.username ?? r.author.name ?? "—",
      diff: (r.diff as unknown as DiffEntry[]) ?? [],
    })),
    ...overrides.map((a) => ({
      kind: "admin" as const,
      id: a.id,
      at: a.createdAt.toISOString(),
      action: a.action as "FORCE_COIN_REVISION" | "DISABLE_COIN_MULTISIG" | "TRANSFER_COIN_CARD",
      reason:
        a.details && typeof a.details === "object" && "reason" in a.details
          ? String((a.details as { reason?: unknown }).reason ?? "") || null
          : null,
    })),
  ];

  return items.sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, limit);
}
