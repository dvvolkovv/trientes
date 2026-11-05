import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { CompareForm } from "@/components/compare/compare-form";

export const dynamic = "force-dynamic";

type SearchParams = { coins?: string };

type CompareRow = {
  id: string;
  slug: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  rank: number;
  priceUsd: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  pctChange1h: number | null;
  pctChange24h: number | null;
  pctChange7d: number | null;
};

async function loadCoinsBySlugs(slugs: string[]): Promise<CompareRow[]> {
  if (slugs.length === 0) return [];
  const rows = await prisma.coin.findMany({
    where: { OR: [{ slug: { in: slugs } }, { id: { in: slugs } }] },
    include: { snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 } },
  });
  return rows.map((c) => {
    const s = c.snapshots[0];
    return {
      id: c.id,
      slug: c.slug,
      symbol: c.symbol,
      name: c.name,
      logoUrl: c.logoUrl,
      rank: c.rank,
      priceUsd: s ? Number(s.priceUsd) : null,
      marketCapUsd: s ? Number(s.marketCapUsd) : null,
      volume24hUsd: s ? Number(s.volume24hUsd) : null,
      circulatingSupply: s?.circulatingSupply ? Number(s.circulatingSupply) : null,
      totalSupply: s?.totalSupply ? Number(s.totalSupply) : null,
      maxSupply: s?.maxSupply ? Number(s.maxSupply) : null,
      pctChange1h: s?.pctChange1h ?? null,
      pctChange24h: s?.pctChange24h ?? null,
      pctChange7d: s?.pctChange7d ?? null,
    };
  });
}

function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toPrecision(4)}`;
}
function fmtSupply(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString();
}
function fmtPct(n: number | null): { text: string; cls: string } {
  if (n == null) return { text: "—", cls: "text-muted" };
  const sign = n >= 0 ? "+" : "";
  return {
    text: `${sign}${n.toFixed(2)}%`,
    cls: n >= 0 ? "text-up" : "text-down",
  };
}

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("compare");

  const raw = (sp.coins ?? "").trim();
  const slugs = raw ? raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 4) : [];
  const rows = await loadCoinsBySlugs(slugs);
  // Preserve URL order; surface missing slugs.
  const byKey: Map<string, CompareRow> = new Map();
  for (const r of rows) { byKey.set(r.id, r); byKey.set(r.slug, r); }
  const orderedRows: CompareRow[] = [];
  const missing: string[] = [];
  for (const s of slugs) {
    const hit = byKey.get(s);
    if (hit && !orderedRows.includes(hit)) orderedRows.push(hit);
    else if (!hit) missing.push(s);
  }

  const metrics: { label: string; render: (r: CompareRow) => React.ReactNode }[] = [
    { label: t("rank"), render: (r) => <span className="num">#{r.rank}</span> },
    { label: t("price"), render: (r) => <span className="num font-medium">{fmtUsd(r.priceUsd)}</span> },
    {
      label: t("change1h"),
      render: (r) => { const f = fmtPct(r.pctChange1h); return <span className={`num ${f.cls}`}>{f.text}</span>; },
    },
    {
      label: t("change24h"),
      render: (r) => { const f = fmtPct(r.pctChange24h); return <span className={`num ${f.cls}`}>{f.text}</span>; },
    },
    {
      label: t("change7d"),
      render: (r) => { const f = fmtPct(r.pctChange7d); return <span className={`num ${f.cls}`}>{f.text}</span>; },
    },
    { label: t("marketCap"), render: (r) => <span className="num">{fmtUsd(r.marketCapUsd)}</span> },
    { label: t("volume24h"), render: (r) => <span className="num">{fmtUsd(r.volume24hUsd)}</span> },
    { label: t("circulating"), render: (r) => <span className="num text-muted">{fmtSupply(r.circulatingSupply)}</span> },
    { label: t("totalSupply"), render: (r) => <span className="num text-muted">{fmtSupply(r.totalSupply)}</span> },
    { label: t("maxSupply"), render: (r) => <span className="num text-muted">{fmtSupply(r.maxSupply)}</span> },
  ];

  return (
    <main className="max-w-[1200px] mx-auto px-4 md:px-12 py-12">
      <header className="mb-8">
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">{t("kicker")}</div>
        <h1 className="text-[36px] md:text-[44px] font-bold tracking-[-0.03em] mb-2">{t("title")}</h1>
        <p className="text-muted">{t("subtitle")}</p>
      </header>

      <CompareForm locale={locale} initial={slugs} />

      {missing.length > 0 && (
        <div className="mt-4 text-[12px] text-muted">
          {t("notFound")}: <span className="num">{missing.join(", ")}</span>
        </div>
      )}

      {orderedRows.length === 0 ? (
        <p className="text-muted mt-8">{t("empty")}</p>
      ) : (
        <section className="mt-8 bg-card border border-hairline rounded-[16px] overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-hairline">
                <th className="text-left text-[11px] uppercase tracking-[0.18em] text-muted px-4 py-3"></th>
                {orderedRows.map((r) => (
                  <th key={r.id} className="text-left px-4 py-3">
                    <Link href={`/${locale}/coin/${r.slug}`} className="flex items-center gap-2 hover:text-accent">
                      {r.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.logoUrl} alt="" className="h-7 w-7 rounded-full" />
                      ) : null}
                      <div>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-[11px] text-muted uppercase">{r.symbol}</div>
                      </div>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.label} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-3 text-[12px] text-muted">{m.label}</td>
                  {orderedRows.map((r) => (
                    <td key={r.id + m.label} className="px-4 py-3 text-[14px]">{m.render(r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
