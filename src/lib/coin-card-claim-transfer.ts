/**
 * Передача владения карточкой по доказательству (слайс D). Отдельно от
 * серверного действия: это единственная операция, которая меняет владельца
 * монеты, и её нужно проверять тестами и живым прогоном, а не только нажатием
 * кнопки в браузере.
 */

import { nextTrust, type ClaimMethod, type Trust } from "@/lib/coin-card-claim";

export type TransferPrismaLike = {
  coinCardMember: {
    upsert(args: unknown): unknown;
    updateMany(args: unknown): unknown;
  };
  coinCard: { update(args: unknown): unknown };
  coinCardClaim: { updateMany(args: unknown): unknown };
  adminAuditLog: { create(args: unknown): unknown };
  $transaction(ops: unknown[]): Promise<unknown[]>;
};

export type TransferInput = {
  cardId: string;
  claimId: string;
  newOwnerId: string;
  previousStewardId: string | null;
  method: ClaimMethod;
  target: string;
  contractVerified: boolean;
};

/**
 * Одной транзакцией: заявитель становится владельцем, прежний куратор
 * понижается до редактора (а не удаляется — дальше решает проект), поднимается
 * уровень доверия, прочие открытые заявки закрываются, событие уходит в
 * публичный аудит.
 */
export async function transferCardOwnership(
  prisma: TransferPrismaLike,
  input: TransferInput,
): Promise<{ trust: Trust }> {
  const trust = nextTrust(input.contractVerified);
  const demote =
    input.previousStewardId && input.previousStewardId !== input.newOwnerId
      ? [
          prisma.coinCardMember.updateMany({
            where: { cardId: input.cardId, userId: input.previousStewardId },
            data: { role: "EDITOR" },
          }),
        ]
      : [];

  await prisma.$transaction([
    prisma.coinCardMember.upsert({
      where: { cardId_userId: { cardId: input.cardId, userId: input.newOwnerId } },
      create: { cardId: input.cardId, userId: input.newOwnerId, role: "OWNER", isSigner: true },
      update: { role: "OWNER", sections: [], isSigner: true },
    }),
    ...demote,
    prisma.coinCard.update({
      where: { id: input.cardId },
      data: { stewardUserId: input.newOwnerId, trust },
    }),
    // Остальные открытые заявки больше не нужны: доказательство предъявлено.
    // Саму победившую заявку исключаем явно — порядок вызовов не должен иметь
    // значения, иначе успешный claim мог бы закрыть сам себя как отменённый.
    prisma.coinCardClaim.updateMany({
      where: { cardId: input.cardId, status: "PENDING", id: { not: input.claimId } },
      data: { status: "CANCELLED" },
    }),
    prisma.adminAuditLog.create({
      data: {
        actorId: input.newOwnerId,
        action: "TRANSFER_COIN_CARD",
        targetType: "CoinCard",
        targetId: input.cardId,
        details: {
          toUserId: input.newOwnerId,
          fromUserId: input.previousStewardId,
          method: input.method,
          target: input.target,
          claimId: input.claimId,
          claim: true,
        },
      },
    }),
  ]);

  return { trust };
}
