import { getTranslations } from "next-intl/server";
import { getProvenance } from "@/lib/coin-card-provenance";
import { ProvenanceBadge } from "../provenance-badge";
import { coinsToNumber } from "@/lib/coin-card-supply";
import {
  allocationBars,
  unlockSummary,
  validateAllocation,
  validateUnlocks,
  type AllocationInput,
  type UnlockInput,
} from "@/lib/coin-card-tokenomics";

type Tokenomics = {
  circulating?: number | null;
  total?: number | null;
  max?: number | null;
  excluded?: Array<{ address?: string; label?: string | null }> | null;
  excludedAddresses?: string[] | null;
  allocation?: AllocationInput[] | null;
  unlocks?: UnlockInput[] | null;
  emission?: string | null;
  // Форма пишет `burn`; `burnMechanism` остался в старых записях. Читаем оба —
  // иначе заполненный проектом текст про сжигание просто не отображается.
  burn?: string | null;
  burnMechanism?: string | null;
};

export type SupplyView = {
  chain: string;
  totalSupply: string;
  excludedTotal: string;
  circulating: string;
  excluded: unknown;
  partial: boolean;
  claimedDeltaPct: number | null;
  checkedAt: Date | string;
  checkError: string | null;
} | null;

type ExcludedRow = {
  address: string;
  label: string | null;
  balance: string | null;
  error: string | null;
};

const fmt = (n: number | null | undefined) =>
  n == null ? null : new Intl.NumberFormat("en-US").format(n);

/** Строка выпуска из базы — в человеческий вид с разделителями. */
const fmtCoins = (s: string | null | undefined) => fmt(coinsToNumber(s));

function excludedRows(raw: unknown): ExcludedRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    if (typeof r.address !== "string") return [];
    return [
      {
        address: r.address,
        label: typeof r.label === "string" ? r.label : null,
        balance: typeof r.balance === "string" ? r.balance : null,
        error: typeof r.error === "string" ? r.error : null,
      },
    ];
  });
}

export async function TokenomicsSection({
  tokenomics,
  provenance,
  supply = null,
  badge = null,
}: {
  tokenomics: unknown;
  provenance: unknown;
  supply?: SupplyView;
  badge?: React.ReactNode;
}) {
  const t = await getTranslations("coinCard");
  const d = (tokenomics ?? {}) as Tokenomics;

  // Проверенный выпуск вытесняет заявление проекта в главных плитках, но не
  // затирает его: при расхождении больше процента заявление показывается рядом.
  const verified = supply && !supply.checkError ? supply : null;
  const circulating = verified ? fmtCoins(verified.circulating) : fmt(d.circulating);
  const total = verified ? fmtCoins(verified.totalSupply) : fmt(d.total);
  const claimedAside =
    verified && verified.claimedDeltaPct != null && Math.abs(verified.claimedDeltaPct) > 1
      ? fmt(d.circulating)
      : null;

  const rows: Array<[string, string | null, string, boolean]> = [
    [t("supply.circulating"), circulating, "supply.circulating", Boolean(verified)],
    [t("supply.total"), total, "tokenomics.total", Boolean(verified)],
    [t("supply.max"), fmt(d.max), "tokenomics.max", false],
  ];
  const supplyRows = rows.filter((r) => r[1] !== null);

  const allocation = validateAllocation(d.allocation);
  const bars = allocation.ok ? allocationBars(allocation.data) : [];

  const unlocksParsed = validateUnlocks(d.unlocks);
  const unlocks = unlocksParsed.ok
    ? unlockSummary(unlocksParsed.data, {
        now: new Date(),
        total: verified ? verified.totalSupply : d.total != null ? String(d.total) : null,
      })
    : null;

  const excluded = verified ? excludedRows(verified.excluded) : [];
  const burn = d.burn ?? d.burnMechanism ?? null;
  const hasMethod =
    (d.excludedAddresses?.length ?? 0) > 0 ||
    (d.excluded?.length ?? 0) > 0 ||
    Boolean(d.emission) ||
    Boolean(burn);

  if (
    supplyRows.length === 0 &&
    !hasMethod &&
    bars.length === 0 &&
    (unlocks?.upcomingCount ?? 0) === 0 &&
    (unlocks?.pastCount ?? 0) === 0
  ) {
    return null;
  }

  return (
    <section id="tokenomics" className="scroll-mt-24">
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">
        {t("sections.tokenomics")}
        {badge}
      </h2>

      {supplyRows.length > 0 && (
        <dl className="grid sm:grid-cols-3 gap-4 mb-6">
          {supplyRows.map(([label, value, path]) => (
            <div key={path} className="border border-hairline rounded-md p-4 bg-card">
              <dt className="text-[12px] uppercase tracking-[0.15em] text-muted mb-1">{label}</dt>
              <dd className="num text-lg">
                {value}
                <ProvenanceBadge entry={getProvenance(provenance, path)} />
                {path === "supply.circulating" && claimedAside && (
                  <span className="block text-xs text-muted mt-1">
                    {t("supply.claimedSays", { value: claimedAside })}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {verified && (
        <details className="border border-hairline rounded-md p-4 bg-card mb-6">
          <summary className="text-[12px] uppercase tracking-[0.15em] text-muted cursor-pointer">
            {t("supply.calculationTitle")}
          </summary>
          <p className="num text-sm mt-3">
            {t("supply.calculation", {
              total: fmtCoins(verified.totalSupply) ?? "—",
              excluded: fmtCoins(verified.excludedTotal) ?? "—",
              count: excluded.length,
            })}{" "}
            = <strong>{fmtCoins(verified.circulating)}</strong>
          </p>
          {excluded.length > 0 && (
            <ul className="mt-3 space-y-1">
              {excluded.map((e) => (
                <li key={e.address} className="text-xs flex flex-wrap gap-x-2">
                  <span className="font-mono break-all text-muted">{e.address}</span>
                  {e.label && <span className="text-muted">· {e.label}</span>}
                  <span className="num">
                    {e.error ? t(`supply.error.${e.error}`) : fmtCoins(e.balance)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted mt-3">
            {verified.partial ? `${t("supply.partial")} · ` : ""}
            {new Date(verified.checkedAt).toISOString().slice(0, 16).replace("T", " ")} UTC ·{" "}
            {verified.chain}
          </p>
        </details>
      )}

      {bars.length > 0 && (
        <div className="border border-hairline rounded-md p-4 bg-card mb-6">
          <h3 className="text-[12px] uppercase tracking-[0.15em] text-muted mb-3">
            {t("allocation.title")}
          </h3>
          <div className="flex h-3 w-full overflow-hidden rounded-sm border border-hairline mb-3">
            {bars.map((b, i) => (
              <div
                key={`${b.label ?? "rest"}-${i}`}
                style={{ width: `${b.pct}%` }}
                className={b.unallocated ? "bg-hairline" : i % 2 === 0 ? "bg-accent" : "bg-up"}
                title={`${b.label ?? t("allocation.unallocated")} · ${b.pct}%`}
              />
            ))}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {bars.map((b, i) => (
                <tr key={`${b.label ?? "rest"}-row-${i}`} className="border-t border-hairline">
                  <td className="py-1.5">{b.label ?? t("allocation.unallocated")}</td>
                  <td className="py-1.5 num text-right">{b.pct}%</td>
                  <td className="py-1.5 text-right text-xs text-muted">
                    {b.cliffMonths != null && t("allocation.cliff", { months: b.cliffMonths })}
                    {b.cliffMonths != null && b.vestingMonths != null ? " · " : ""}
                    {b.vestingMonths != null && t("allocation.vesting", { months: b.vestingMonths })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unlocks && (unlocks.upcomingCount > 0 || unlocks.pastCount > 0) && (
        <div className="border border-hairline rounded-md p-4 bg-card mb-6">
          <h3 className="text-[12px] uppercase tracking-[0.15em] text-muted mb-3">
            {t("unlocks.title")}
          </h3>
          {unlocks.pct30 != null && unlocks.pct90 != null && unlocks.upcomingCount > 0 && (
            <p className="text-sm num mb-3">
              {t("unlocks.windows", {
                pct30: unlocks.pct30.toFixed(2),
                pct90: unlocks.pct90.toFixed(2),
              })}
            </p>
          )}
          {unlocks.next.length > 0 && (
            <table className="w-full text-sm">
              <tbody>
                {unlocks.next.map((u) => (
                  <tr key={`${u.date}-${u.label}`} className="border-t border-hairline">
                    <td className="py-1.5 num whitespace-nowrap">{u.date}</td>
                    <td className="py-1.5">{u.label}</td>
                    <td className="py-1.5 num text-right">
                      {u.pct != null ? `${u.pct}%` : fmt(u.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-muted mt-3">
            {unlocks.upcomingCount > unlocks.next.length &&
              `${t("unlocks.more", { count: unlocks.upcomingCount - unlocks.next.length })} · `}
            {unlocks.pastCount > 0 && t("unlocks.past", { count: unlocks.pastCount })}
          </p>
        </div>
      )}

      {hasMethod && (
        <div className="border border-hairline rounded-md p-4 bg-card space-y-3">
          <h3 className="text-[12px] uppercase tracking-[0.15em] text-muted">
            {t("supply.methodology")}
          </h3>
          {d.emission && <p className="text-sm">{t("supply.emission")}: {d.emission}</p>}
          {burn && <p className="text-sm">{t("supply.burn")}: {burn}</p>}
          {!verified && ((d.excluded?.length ?? 0) > 0 || (d.excludedAddresses?.length ?? 0) > 0) && (
            <div>
              <p className="text-sm text-muted mb-1">{t("supply.excluded")}</p>
              <ul className="space-y-1">
                {(d.excluded ?? []).map((e) => (
                  <li key={e.address} className="font-mono text-xs break-all text-muted">
                    {e.address}
                    {e.label ? ` · ${e.label}` : ""}
                  </li>
                ))}
                {(d.excludedAddresses ?? []).map((a) => (
                  <li key={a} className="font-mono text-xs break-all text-muted">{a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
