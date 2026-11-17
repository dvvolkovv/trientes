/**
 * Конфликт интересов: сотрудник не ведёт и не решает дело объекта, с которым он
 * связан. Правило четырёх глаз различает людей, но ничего не знает о том, что
 * проверяющий сам сидит в команде проверяемого предприятия.
 *
 * Чтение не запрещается: смотреть незачем запрещать, а знать причину отказа
 * полезно. Блокируется всё изменяющее.
 */
import type { CaseSubjectType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ConflictFacts = {
  isApplicant: boolean;
  isCompanyMember: boolean;
  isCardMember: boolean;
};

export type ConflictReason = "conflict_of_interest";

export function conflictReason(f: ConflictFacts): ConflictReason | null {
  return f.isApplicant || f.isCompanyMember || f.isCardMember ? "conflict_of_interest" : null;
}

export async function caseConflict(input: {
  caseId: string;
  subjectType: CaseSubjectType;
  subjectId: string;
  applicantUserId: string | null;
  userId: string;
}): Promise<ConflictReason | null> {
  const facts: ConflictFacts = {
    // Своя заявка — конфликт при любом типе дела и самый частый из трёх.
    isApplicant: !!input.applicantUserId && input.applicantUserId === input.userId,
    isCompanyMember: false,
    isCardMember: false,
  };

  if (input.subjectType === "COMPANY" || input.subjectType === "KYB") {
    facts.isCompanyMember = await isCompanyMember(input.subjectId, input.userId);
  } else if (input.subjectType === "POINT" || input.subjectType === "POINT_REPORT") {
    const pointId =
      input.subjectType === "POINT"
        ? input.subjectId
        : ((
            await prisma.pointReport.findUnique({
              where: { id: input.subjectId },
              select: { pointId: true },
            })
          )?.pointId ?? null);
    if (pointId) {
      const point = await prisma.companyPoint.findUnique({
        where: { id: pointId },
        select: { companyId: true },
      });
      if (point) facts.isCompanyMember = await isCompanyMember(point.companyId, input.userId);
    }
  } else if (input.subjectType === "COIN_CARD") {
    facts.isCardMember =
      (await prisma.coinCardMember.count({
        where: { cardId: input.subjectId, userId: input.userId },
      })) > 0;
  }

  return conflictReason(facts);
}

async function isCompanyMember(companyId: string, userId: string): Promise<boolean> {
  return (
    (await prisma.companyMember.count({ where: { companyId, userId } })) > 0 ||
    (await prisma.company.count({ where: { id: companyId, ownerUserId: userId } })) > 0
  );
}
