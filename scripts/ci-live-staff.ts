/** Два временных проверяющих с правом на очередь заявок + их сеансы. */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { newTotpSecret } from "../src/lib/mfa/totp";
import { sealSecret } from "../src/lib/mfa/secret-store";

async function staff(username: string) {
  const user = await prisma.user.create({
    data: { username, name: username, role: "STAFF" },
    select: { id: true },
  });
  await prisma.staffMember.create({
    data: {
      userId: user.id,
      title: "CI live reviewer",
      duties: "slice CI live run",
      accessReviewAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.staffGrant.create({
    data: { userId: user.id, queue: "domainClaims", level: "APPROVE" },
  });
  // Сотруднику второй фактор обязателен (слайс BA): без заведённого ключа
  // админка уводит на его заведение — это живой прогон и показал.
  await prisma.staffMfa.create({
    data: {
      userId: user.id,
      kind: "TOTP",
      secretEnc: sealSecret(newTotpSecret()),
      confirmedAt: new Date(),
    },
  });

  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      sessionToken: token,
      userId: user.id,
      expires: new Date(Date.now() + 6 * 60 * 60 * 1000),
      // Второй фактор сотруднику обязателен; у временного его нет, поэтому
      // штамп ставим сразу — иначе прогон упёрся бы в экран кода (слайс BA).
      mfaAt: new Date(),
    },
  });
  return { id: user.id, username, token };
}

async function main() {
  console.log(JSON.stringify({
    reviewer: await staff("ci-live-reviewer"),
    approver: await staff("ci-live-approver"),
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
