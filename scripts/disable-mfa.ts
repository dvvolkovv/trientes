/**
 * Аварийный выход: снять второй фактор с записи прямо на сервере.
 *
 * Зачем он есть. Фактор — дверь в админку, и если телефон потерян вместе с
 * кодами восстановления, снять фактор может только **другой** владелец. У нас
 * владелец один, то есть такой человек заперт навсегда. Этот скрипт — тот
 * самый «другой владелец», и работает он только с машины, где лежит база.
 *
 *   npx tsx scripts/disable-mfa.ts --user=<id|имя входа|адрес> --reason="потерян телефон"
 *   npx tsx scripts/disable-mfa.ts --list
 *
 * Снятие гасит все сеансы записи: иначе фактор остался бы «показанным» в живом
 * сеансе, и смысл снятия терялся бы.
 */
import { prisma } from "../src/lib/prisma";
import { disableMfa } from "../src/lib/mfa/service";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  if (process.argv.includes("--list")) {
    const rows = await prisma.staffMfa.findMany({
      select: {
        userId: true,
        confirmedAt: true,
        disabledAt: true,
        user: { select: { username: true, email: true, role: true } },
        recoveryCodes: { where: { usedAt: null }, select: { id: true } },
      },
    });
    for (const r of rows) {
      const who = r.user.username ?? r.user.email ?? r.userId;
      const state = r.disabledAt ? `снят ${r.disabledAt.toISOString()}` : r.confirmedAt ? `включён ${r.confirmedAt.toISOString()}` : "не подтверждён";
      console.log(`${who} (${r.user.role}): ${state}, кодов восстановления ${r.recoveryCodes.length}`);
    }
    if (rows.length === 0) console.log("ни у кого фактор не заведён");
    await prisma.$disconnect();
    return;
  }

  const who = arg("user");
  const reason = arg("reason");
  if (!who || !reason || reason.trim().length < 3) {
    console.error("usage: --user=<id|username|email> --reason=\"...\"  (или --list)");
    process.exit(1);
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ id: who }, { username: who }, { email: who }] },
    select: { id: true, username: true, email: true },
  });
  if (!user) {
    console.error(`запись не найдена: ${who}`);
    process.exit(1);
  }

  const mfa = await prisma.staffMfa.findUnique({ where: { userId: user.id }, select: { userId: true } });
  if (!mfa) {
    console.error("у этой записи фактор не заведён — снимать нечего");
    process.exit(1);
  }

  // Исполнителем пишем саму запись: снятие с сервера совершает не человек из
  // базы, а тот, у кого доступ к машине; приписывать это владельцу было бы
  // неправдой в журнале.
  await disableMfa({ targetUserId: user.id, byUserId: user.id, reason: `[сервер] ${reason.trim()}` });
  await prisma.adminAuditLog.create({
    data: {
      actorId: user.id,
      action: "STAFF_MFA_DISABLED",
      targetType: "User",
      targetId: user.id,
      details: { reason: `[сервер] ${reason.trim()}`, via: "scripts/disable-mfa.ts" },
    },
  });
  console.log(`фактор снят: ${user.username ?? user.email ?? user.id}; все сеансы погашены`);
  await prisma.$disconnect();
}

main();
