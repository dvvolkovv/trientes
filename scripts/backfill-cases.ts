/**
 * Разовый посев: заводит дела под заявки, поданные до слайса AN. Без него
 * очереди после выкатки окажутся пустыми, хотя заявки лежат.
 *
 *   npx tsx scripts/backfill-cases.ts --dump    # показать, что будет заведено
 *   npx tsx scripts/backfill-cases.ts           # завести
 */
import type { CaseSubjectType } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { ensureCase } from "../src/lib/cases/ensure";
import { loadSubject } from "../src/lib/cases/subject";

const DUMP = process.argv.includes("--dump");

type Planned = { type: CaseSubjectType; id: string; title: string; openedAt: Date };

async function collect(): Promise<Planned[]> {
  const planned: Planned[] = [];

  for (const c of await prisma.company.findMany({ where: { status: "PENDING", deletedAt: null } })) {
    planned.push({ type: "COMPANY", id: c.id, title: c.displayName, openedAt: c.createdAt });
  }
  for (const p of await prisma.companyPoint.findMany({
    where: { status: "PENDING", deletedAt: null, company: { deletedAt: null } },
  })) {
    planned.push({ type: "POINT", id: p.id, title: p.name, openedAt: p.createdAt });
  }
  for (const card of await prisma.coinCard.findMany({ where: { status: "PENDING" } })) {
    planned.push({
      type: "COIN_CARD",
      id: card.id,
      title: `${card.name} (${card.symbol})`,
      openedAt: card.createdAt,
    });
  }
  for (const r of await prisma.coinRequest.findMany({ where: { status: "PENDING" } })) {
    planned.push({
      type: "COIN_REQUEST",
      id: r.id,
      title: `${r.name} (${r.symbol})`,
      openedAt: r.createdAt,
    });
  }
  for (const e of await prisma.registeredExchange.findMany({ where: { status: "PENDING" } })) {
    planned.push({ type: "EXCHANGE", id: e.id, title: e.displayName, openedAt: e.createdAt });
  }
  for (const f of await prisma.fintechCompany.findMany({ where: { status: "PENDING" } })) {
    planned.push({ type: "FINTECH", id: f.id, title: f.displayName, openedAt: f.createdAt });
  }
  // Проверка KYB — отдельное дело того же предприятия (другой срок, другой
  // лист). До слайса AT подача его не заводила вовсе, поэтому ходим и здесь.
  for (const c of await prisma.company.findMany({
    where: { kybStatus: "PENDING", deletedAt: null },
  })) {
    planned.push({
      type: "KYB",
      id: c.id,
      title: c.displayName,
      openedAt: c.kybSubmittedAt ?? c.createdAt,
    });
  }

  return planned;
}

async function main() {
  const planned = await collect();

  if (DUMP) {
    for (const p of planned) {
      console.log(`${p.type}\t${p.id}\t${p.openedAt.toISOString()}\t${p.title}`);
    }
    console.log(`\nвсего: ${planned.length}`);
    return;
  }

  let made = 0;
  for (const p of planned) {
    const summary = await loadSubject(p.type, p.id);
    await ensureCase({
      subjectType: p.type,
      subjectId: p.id,
      title: p.title,
      applicantUserId: summary?.applicantUserId ?? null,
      openedAt: p.openedAt,
    });
    made += 1;
  }
  console.log(`дел заведено или уже было: ${made}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
