import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { isStaffRole, type ViewerRole } from "@/lib/authz/policy";
import { requireCabinetUser } from "@/lib/cabinet/viewer";
import { readViewerSectionColors } from "@/lib/admin-appearance";
import { sectionColorHex } from "@/lib/section-colors";
import {
  cabinetColorKey,
  visibleCabinetTiles,
  type CabinetCounter,
} from "@/lib/cabinet/personal-nav";
import { CabinetTile, TILE_GRID } from "@/components/cabinet/cabinet-tile";
import { CabinetHashRedirect } from "@/components/cabinet/hash-redirect";
import { ADMIN_COLUMN } from "@/lib/admin-ui";

export const dynamic = "force-dynamic";

/**
 * Хаб личного кабинета (слайс BS): в шапке профиль, всё остальное — плитками.
 *
 * Числа считаются отдельными `count`, а не вызовом выборок секций: хабу нужно
 * число, а не строки, и прежняя страница из тринадцати секций грузила заявки,
 * предприятия, карточки, биржи и 250 монет даже тому, кто зашёл сменить валюту.
 */
export default async function CabinetPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCabinetUser(locale);
  const t = await getTranslations();
  const colors = await readViewerSectionColors();
  const isStaff = isStaffRole(user.role as ViewerRole);
  const userId = user.id;

  const [cases, companies, coins, exchanges, messages, unread, subscriptions, priceAlerts, geoAlerts, receipts] =
    await Promise.all([
      prisma.complianceCase.count({ where: { applicantUserId: userId } }),
      prisma.companyMember.count({ where: { userId } }),
      prisma.coinCard.count({ where: { members: { some: { userId } } } }),
      prisma.registeredExchange.count({ where: { ownerUserId: userId } }),
      prisma.customerThread.count({ where: { customerUserId: userId } }),
      // Непрочитанное считается по стороне (правило BQ): нитка, в которой
      // последнее сообщение пришло позже, чем покупатель её открывал.
      prisma.customerThread.count({
        where: {
          customerUserId: userId,
          OR: [
            { customerReadAt: null },
            { lastMessageAt: { gt: prisma.customerThread.fields.customerReadAt } },
          ],
        },
      }),
      prisma.companyFollow.count({ where: { userId } }),
      prisma.priceAlert.count({ where: { userId } }),
      prisma.geoAlert.count({ where: { userId } }),
      prisma.sale.count({ where: { buyerUserId: userId } }),
    ]);

  const counts: Record<CabinetCounter, number> = {
    cases,
    companies,
    coins,
    exchanges,
    messages,
    subscriptions,
    alerts: priceAlerts + geoAlerts,
    receipts,
  };

  return (
    <main className={`${ADMIN_COLUMN} py-10 md:py-14`}>
      <CabinetHashRedirect locale={locale} />
      <header className="mb-8">
        <div className="num mb-2 text-[11px] uppercase tracking-[0.3em] text-muted">
          {t("cabinet.kicker")}
        </div>
        <h1 className="mb-4 text-[28px] font-bold tracking-[-0.03em] sm:text-[36px]">
          {t("cabinet.title")}
        </h1>

        {/* Единственное, что стоит в шапке, — «кто я». Всё прочее ушло в плитки. */}
        <div className="rounded-[22px] border border-hairline bg-card p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full border border-hairline bg-card-alt">
              {user.image ? (
                // Снимок бывает и с чужого хоста (Google, GitHub) — обычный <img>.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.image} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[18px] font-bold text-muted">
                  {(
                    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
                    user.username ||
                    "?"
                  )
                    .trim()[0]
                    ?.toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {/* Имя входа — одно длинное слово без пробелов, и на 280 px оно
                    распирало шапку кабинета. `anywhere` уменьшает и минимальную
                    ширину блока, чего `break-words` не делает. */}
                <span className="min-w-0 text-[20px] font-bold tracking-[-0.02em] [overflow-wrap:anywhere]">
                  {[user.firstName, user.lastName].filter(Boolean).join(" ") || user.username}
                </span>
                <span className="num text-[13px] text-muted">@{user.username}</span>
              </div>
              <div className="mt-1 truncate text-[13px] text-muted">
                {user.email ? (
                  <>
                    {user.email}
                    {user.emailVerified ? " ✓" : ""}
                  </>
                ) : (
                  t("cabinet.hub.noEmail")
                )}
              </div>
            </div>
          </div>
          <Link
            href={`/${locale}/cabinet/profile`}
            className="mt-4 flex h-12 w-full items-center justify-center rounded-[14px] border border-hairline bg-card-alt px-4 text-sm font-semibold transition-colors hover:border-accent/60 sm:w-fit sm:px-8"
          >
            {t("cabinet.hub.editProfile")}
          </Link>
        </div>
      </header>

      <div className={TILE_GRID}>
        {visibleCabinetTiles(isStaff).map((tile) => (
          <CabinetTile
            key={tile.key}
            href={tile.external ? `/${locale}/${tile.path}` : `/${locale}/cabinet/${tile.path}`}
            icon={tile.icon}
            label={t(tile.labelKey)}
            value={tile.counter ? counts[tile.counter] : null}
            hint={tile.hintKey ? t(tile.hintKey) : null}
            badge={tile.key === "messages" && unread > 0 ? `🔔 ${unread}` : null}
            colorHex={sectionColorHex(colors, cabinetColorKey(tile.key))}
          />
        ))}
      </div>
    </main>
  );
}
