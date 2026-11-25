import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getViewerCompanyById, canManageMembers } from "@/lib/business";
import { CabinetTile, TILE_GRID } from "@/components/cabinet/cabinet-tile";
import { ADMIN_COLUMN } from "@/lib/admin-ui";
import { groupByKey, visibleTiles, GROUP_ICONS, type CompanyTileDef } from "@/lib/cabinet/company-nav";
import { NOT_DELETED } from "@/lib/soft-delete";
import { storeUnreadTotal } from "@/lib/customer-messages/read";
import { readChatUnread } from "@/lib/company-chat/read";
import { CabinetBackButton } from "@/components/cabinet/back-button";

export const dynamic = "force-dynamic";

/**
 * Страница группы разделов (слайс BM). Одна страница на все три группы: три почти
 * одинаковых файла разошлись бы, а список плиток и так живёт картой
 * `src/lib/cabinet/company-nav.ts`.
 *
 * Число на плитке — причина её завести: плитка без числа это просто большая кнопка
 * (то же решение, что в очередях AN). Считаются только видимые плитки — запрос на
 * раздел, которого человеку не видно, это работа впустую.
 */
export default async function CompanyGroupPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; group: string }>;
}) {
  const { locale, id, group: groupParam } = await params;
  setRequestLocale(locale);
  const group = groupByKey(groupParam);
  if (!group) notFound();
  const t = await getTranslations("business");
  const { userId, company, role, permissions } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();

  const isOwner = canManageMembers(role);
  const tiles = visibleTiles(group, { permissions, isOwner });
  // Группа без ни одной доступной плитки не существует для этого человека: 404, а
  // не пустая страница — пустая читалась бы как «тут ничего нет», а дело в правах.
  if (tiles.length === 0) notFound();

  const base = `/${locale}/cabinet/companies/${company.id}`;
  const counts = await countTiles(company.id, userId, tiles);

  return (
    <main className={`${ADMIN_COLUMN} overflow-x-clip py-8 space-y-6`}>
      <CabinetBackButton locale={locale} />
      <div>
        <Link href={base} className="text-[12px] text-muted underline">
          ← {company.displayName}
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-[26px] font-bold tracking-[-0.03em]">
          <span>{GROUP_ICONS[group]}</span>
          {t(`groups.${group}`)}
        </h1>
        <p className="mt-1 text-sm text-muted">{t(`groupHint.${group}`)}</p>
      </div>

      <div className={TILE_GRID}>
        {tiles.map((tile) => (
          <CabinetTile
            key={tile.key}
            href={`${base}/${tile.path}`}
            icon={tile.icon}
            label={t(`tiles.${tile.key}`)}
            value={counts[tile.key]?.value ?? null}
            hint={
              counts[tile.key]?.value
                ? t(`tileUnit.${tile.key}`, { count: counts[tile.key]!.value })
                : t("tileEmpty")
            }
            badge={counts[tile.key]?.badge ?? null}
          />
        ))}
      </div>
    </main>
  );
}

type TileCount = { value: number; badge?: string | null };

async function countTiles(
  companyId: string,
  userId: string,
  tiles: CompanyTileDef[],
): Promise<Record<string, TileCount | undefined>> {
  const want = new Set(tiles.map((tile) => tile.key));
  const out: Record<string, TileCount | undefined> = {};
  const jobs: Promise<void>[] = [];

  if (want.has("points")) {
    jobs.push(
      (async () => {
        const [total, pendingCount] = await Promise.all([
          prisma.companyPoint.count({ where: { companyId, ...NOT_DELETED } }),
          prisma.companyPoint.count({ where: { companyId, status: "PENDING", ...NOT_DELETED } }),
        ]);
        out.points = { value: total, badge: pendingCount > 0 ? String(pendingCount) : null };
      })(),
    );
  }
  if (want.has("products")) {
    jobs.push(
      (async () => {
        out.products = { value: await prisma.productOffer.count({ where: { companyId } }) };
      })(),
    );
  }
  if (want.has("pricing")) {
    jobs.push(
      (async () => {
        out.pricing = { value: await prisma.cashbackRule.count({ where: { companyId } }) };
      })(),
    );
  }
  if (want.has("promos")) {
    jobs.push(
      (async () => {
        out.promos = { value: await prisma.merchantPromo.count({ where: { companyId, archivedAt: null } }) };
      })(),
    );
  }
  if (want.has("customers")) {
    jobs.push(
      (async () => {
        // Число — нитки, значок — непрочитанное **магазина**: оно на сторону, а не на
        // человека (BQ § 2.5), поэтому первый прочитавший гасит его смене.
        const [all, unread] = await Promise.all([
          prisma.customerThread.count({ where: { companyId } }),
          storeUnreadTotal(companyId),
        ]);
        out.customers = { value: all, badge: unread > 0 ? String(unread) : null };
      })(),
    );
  }
  if (want.has("sales")) {
    jobs.push(
      (async () => {
        // Число — чеки за сутки: «всего за всё время» на плитке кассы не говорит ничего
        // о сегодняшней работе, а именно её открывают утром.
        const since = new Date();
        since.setUTCHours(0, 0, 0, 0);
        out.sales = {
          value: await prisma.sale.count({ where: { companyId, status: "COMPLETED", createdAt: { gte: since } } }),
        };
      })(),
    );
  }
  if (want.has("reports")) {
    jobs.push(
      (async () => {
        // Число — исполненные чеки за 30 дней: отчётность читают месяцем, а не днём,
        // и это ровно тот период, который открывается на странице по умолчанию.
        const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        out.reports = {
          value: await prisma.sale.count({
            where: { companyId, status: "COMPLETED", createdAt: { gte: since } },
          }),
        };
      })(),
    );
  }
  if (want.has("warehouses")) {
    jobs.push(
      (async () => {
        out.warehouses = { value: await prisma.warehouse.count({ where: { companyId, archivedAt: null } }) };
      })(),
    );
  }
  if (want.has("supply")) {
    jobs.push(
      (async () => {
        out.supply = {
          value: await prisma.supplyOrder.count({
            where: { companyId, status: { notIn: ["RECEIVED", "CANCELLED"] } },
          }),
        };
      })(),
    );
  }
  if (want.has("team")) {
    jobs.push(
      (async () => {
        out.team = { value: await prisma.companyMember.count({ where: { companyId } }) };
      })(),
    );
  }
  if (want.has("tasks")) {
    jobs.push(
      (async () => {
        // Своих задач у члена без права на раздел может быть сколько угодно, и число
        // на плитке должно говорить про него, а не про предприятие.
        const open = { notIn: ["DONE", "CANCELLED"] as ("DONE" | "CANCELLED")[] };
        const [mine, all] = await Promise.all([
          prisma.companyTask.count({ where: { companyId, assigneeId: userId, status: open } }),
          prisma.companyTask.count({ where: { companyId, status: open } }),
        ]);
        out.tasks = { value: all, badge: mine > 0 ? String(mine) : null };
      })(),
    );
  }
  if (want.has("chat")) {
    jobs.push(
      (async () => {
        // Число — весь разговор, значок — непрочитанное **этого** человека: оно личное,
        // а не на смену, как в делах комплайнса (спека BP, § 2.3).
        const [all, unread] = await Promise.all([
          prisma.companyChatMessage.count({ where: { companyId, deletedAt: null } }),
          readChatUnread(companyId, userId),
        ]);
        out.chat = { value: all, badge: unread > 0 ? String(unread) : null };
      })(),
    );
  }
  if (want.has("journal")) {
    jobs.push(
      (async () => {
        out.journal = { value: await prisma.companyActionLog.count({ where: { companyId } }) };
      })(),
    );
  }

  await Promise.all(jobs);
  return out;
}
