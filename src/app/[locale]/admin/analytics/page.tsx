import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";

export const dynamic = "force-dynamic";

type Window = "24h" | "7d" | "30d";

const WINDOW_HOURS: Record<Window, number> = { "24h": 24, "7d": 168, "30d": 720 };

function asWindow(raw: string | undefined): Window {
  return raw === "7d" || raw === "30d" ? raw : "24h";
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

export default async function AdminAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ w?: string }>;
}) {
  const { locale } = await params;
  const { w } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("admin.analytics");

  const win = asWindow(w);
  const since = new Date(Date.now() - WINDOW_HOURS[win] * 60 * 60 * 1000);

  // Pull all aggregates in parallel.
  const [totalViews, uniqueRows, topPaths, topReferrers, topCountries, topLocales, dailyRows] = await Promise.all([
    prisma.pageView.count({ where: { createdAt: { gte: since } } }),
    prisma.pageView.findMany({
      where: { createdAt: { gte: since }, sessionId: { not: null } },
      select: { sessionId: true },
      distinct: ["sessionId"],
    }),
    prisma.$queryRaw<{ path: string; n: bigint }[]>`
      SELECT "path", COUNT(*)::bigint AS n
      FROM "PageView"
      WHERE "createdAt" >= ${since}
      GROUP BY "path"
      ORDER BY n DESC
      LIMIT 20
    `,
    prisma.$queryRaw<{ referrer: string; n: bigint }[]>`
      SELECT "referrer", COUNT(*)::bigint AS n
      FROM "PageView"
      WHERE "createdAt" >= ${since} AND "referrer" IS NOT NULL
      GROUP BY "referrer"
      ORDER BY n DESC
      LIMIT 15
    `,
    prisma.$queryRaw<{ country: string; n: bigint }[]>`
      SELECT "country", COUNT(*)::bigint AS n
      FROM "PageView"
      WHERE "createdAt" >= ${since} AND "country" IS NOT NULL
      GROUP BY "country"
      ORDER BY n DESC
      LIMIT 15
    `,
    prisma.$queryRaw<{ locale: string; n: bigint }[]>`
      SELECT "locale", COUNT(*)::bigint AS n
      FROM "PageView"
      WHERE "createdAt" >= ${since} AND "locale" IS NOT NULL
      GROUP BY "locale"
      ORDER BY n DESC
      LIMIT 15
    `,
    prisma.$queryRaw<{ bucket: Date; n: bigint }[]>`
      SELECT date_trunc('hour', "createdAt") AS bucket, COUNT(*)::bigint AS n
      FROM "PageView"
      WHERE "createdAt" >= ${since}
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
  ]);

  const uniqueSessions = uniqueRows.length;
  const maxBucket = dailyRows.length > 0 ? Math.max(...dailyRows.map((r) => Number(r.n))) : 1;

  return (
    <>
      <AdminNav locale={locale} active="analytics" />
      <header className="mb-8">
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-3">Admin</div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">{t("title")}</h1>
        <p className="text-muted">{t("subtitle")}</p>
      </header>

      <div className="flex items-center gap-2 mb-6">
        {(["24h", "7d", "30d"] as const).map((opt) => (
          <a
            key={opt}
            href={opt === "24h" ? "?" : `?w=${opt}`}
            className={
              win === opt
                ? "text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-foreground text-bg"
                : "text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-card text-muted hover:text-foreground border border-hairline"
            }
          >
            {opt}
          </a>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <StatCard label={t("totalViews")} value={fmtInt(totalViews)} />
        <StatCard label={t("uniqueSessions")} value={fmtInt(uniqueSessions)} />
      </div>

      <section className="bg-card border border-hairline rounded-[16px] p-4 mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">{t("timeline")}</h2>
        {dailyRows.length === 0 ? (
          <p className="text-muted text-sm">{t("empty")}</p>
        ) : (
          <div className="flex items-end gap-[2px] h-32">
            {dailyRows.map((r, i) => {
              const n = Number(r.n);
              const h = Math.max(2, Math.round((n / maxBucket) * 128));
              return (
                <div
                  key={i}
                  title={`${r.bucket.toISOString().slice(0, 16)}: ${n}`}
                  style={{ height: `${h}px` }}
                  className="flex-1 min-w-[2px] bg-accent/70 rounded-sm"
                />
              );
            })}
          </div>
        )}
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <ListCard title={t("topPaths")} rows={topPaths.map((r) => ({ label: r.path, n: Number(r.n) }))} />
        <ListCard title={t("topReferrers")} rows={topReferrers.map((r) => ({ label: r.referrer, n: Number(r.n) }))} />
        <ListCard title={t("topCountries")} rows={topCountries.map((r) => ({ label: r.country, n: Number(r.n) }))} />
        <ListCard title={t("topLocales")} rows={topLocales.map((r) => ({ label: r.locale, n: Number(r.n) }))} />
      </div>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-hairline rounded-[16px] p-5">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="text-[40px] font-bold tracking-[-0.03em] mt-1">{value}</div>
    </div>
  );
}

function ListCard({ title, rows }: { title: string; rows: { label: string; n: number }[] }) {
  const total = rows.reduce((s, r) => s + r.n, 0) || 1;
  return (
    <div className="bg-card border border-hairline rounded-[16px] p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-muted text-sm">—</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={i} className="relative">
              <div className="flex items-center justify-between text-sm gap-3">
                <span className="truncate">{r.label}</span>
                <span className="num text-muted shrink-0">{fmtInt(r.n)}</span>
              </div>
              <div
                className="h-1 rounded bg-accent/30 mt-1"
                style={{ width: `${(r.n / total) * 100}%` }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
