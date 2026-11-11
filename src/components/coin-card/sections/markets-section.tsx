import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { getProvenance } from "@/lib/coin-card-provenance";
import { formatCompact, formatPercent, formatPrice } from "@/lib/format";
import { isOwnDexMarket } from "@/lib/coin-card-dex-market";
import { ProvenanceBadge } from "../provenance-badge";
import { ExternalLink } from "../external-link";

type Market = {
  id: string;
  kind: string;
  exchangeName: string;
  pair: string;
  tradeUrl: string | null;
  chain: string | null;
  priceUsd: number | null;
  volumeUsd24h: number | null;
  change24h: number | null;
  isOutlier: boolean;
  checkError: string | null;
  confirmedAt: Date | string | null;
};

/** Ошибки, которые говорят о самом заявлении, а не о нашей связи с биржей. */
const CLAIM_ERRORS = new Set(["pair_not_found", "base_mismatch"]);

/**
 * Статус строки одним словом. Три состояния и три смысла: ошибка заявления
 * (проект назвал пару, которой нет), ошибка связи с биржей, и обычное
 * «проверено». Цвет повторяет смысл, а не красит ради цвета.
 */
function statusTone(m: Market): "bad" | "muted" | "good" {
  if (m.checkError) return CLAIM_ERRORS.has(m.checkError) ? "bad" : "muted";
  if (m.isOutlier) return "muted";
  return m.confirmedAt ? "good" : "muted";
}

const TONE_CLASS: Record<"bad" | "muted" | "good", string> = {
  bad: "text-down border-down/40 bg-down/10",
  muted: "text-muted border-hairline bg-bg-tint",
  good: "text-up border-up/40 bg-up/10",
};

export async function MarketsSection({
  markets,
  provenance,
}: {
  markets: Market[];
  provenance: unknown;
}) {
  const t = await getTranslations("coinCard");
  if (markets.length === 0) return null;

  const hasPrices = markets.some((m) => m.priceUsd != null);
  // Свой обмен — первой строкой: у монеты, которой нет на биржах, он
  // единственный рынок, и искать его в хвосте списка бессмысленно.
  const rows = [...markets].sort(
    (a, b) => Number(isOwnDexMarket(b)) - Number(isOwnDexMarket(a)),
  );

  const statusLabel = (m: Market) =>
    m.checkError
      ? t(`market.error.${m.checkError}`)
      : m.isOutlier
        ? t("market.outlier")
        : m.confirmedAt
          ? t("market.confirmed")
          : t("market.claimed");

  const price = (m: Market) => (m.priceUsd != null ? formatPrice(m.priceUsd) : "—");
  const volume = (m: Market) => (m.volumeUsd24h != null ? formatCompact(m.volumeUsd24h) : "—");
  const changeClass = (m: Market) =>
    m.change24h == null ? "text-muted" : m.change24h >= 0 ? "text-up" : "text-down";

  const exchangeCell = (m: Market, own: boolean) => (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      {own && (
        <Image
          src="/logo.png"
          alt=""
          width={20}
          height={20}
          className="rounded-full border border-hairline shrink-0"
        />
      )}
      <ExternalLink href={m.tradeUrl} className="text-accent hover:underline">
        {m.exchangeName}
      </ExternalLink>
      {!m.tradeUrl && m.exchangeName}
    </span>
  );

  const kindLabel = (m: Market) => (m.chain ? `${m.kind} · ${m.chain}` : m.kind);

  return (
    <section id="card-markets" className="scroll-mt-24">
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">
        {t("sections.markets")}
        <ProvenanceBadge entry={getProvenance(provenance, "markets")} />
      </h2>

      {/* Широкий экран: таблица. Каждая колонка выровнена так же, как её
          заголовок, — число под числом, подпись под подписью. */}
      <div className="hidden md:block border border-hairline rounded-[16px] bg-card overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <thead className="text-muted text-[11px] uppercase tracking-[0.15em]">
            <tr className="border-b border-hairline">
              <th className="text-left font-medium px-5 py-3.5 w-[22%]">{t("market.exchange")}</th>
              <th className="text-center font-medium px-3 py-3.5 w-[18%]">{t("market.pair")}</th>
              <th className="text-center font-medium px-3 py-3.5 w-[14%]">{t("market.kind")}</th>
              {hasPrices && (
                <th className="text-center font-medium px-3 py-3.5 w-[14%]">{t("market.price")}</th>
              )}
              {hasPrices && (
                <th className="text-center font-medium px-3 py-3.5 w-[10%]">
                  {t("market.change24h")}
                </th>
              )}
              {hasPrices && (
                <th className="text-center font-medium px-3 py-3.5 w-[12%]">
                  {t("market.volume24h")}
                </th>
              )}
              <th className="text-center font-medium px-3 py-3.5 w-[14%]">{t("market.status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const own = isOwnDexMarket(m);
              return (
                <tr
                  key={m.id}
                  className={`border-b border-hairline last:border-0 align-middle transition-colors hover:bg-bg-tint/60 ${
                    own ? "bg-bg-tint" : ""
                  }`}
                >
                  <td className="px-5 py-3.5 truncate">{exchangeCell(m, own)}</td>
                  <td className="px-3 py-3.5 text-center num whitespace-nowrap">{m.pair}</td>
                  <td className="px-3 py-3.5 text-center text-muted text-[12px] whitespace-nowrap">
                    {kindLabel(m)}
                  </td>
                  {hasPrices && (
                    <td className="px-3 py-3.5 text-center num whitespace-nowrap">{price(m)}</td>
                  )}
                  {hasPrices && (
                    <td className={`px-3 py-3.5 text-center num ${changeClass(m)}`}>
                      {m.change24h != null ? formatPercent(m.change24h) : "—"}
                    </td>
                  )}
                  {hasPrices && (
                    <td className="px-3 py-3.5 text-center num whitespace-nowrap">{volume(m)}</td>
                  )}
                  <td className="px-3 py-3.5 text-center">
                    <span
                      className={`inline-block text-[10px] uppercase tracking-[0.1em] border rounded-full px-2 py-0.5 ${
                        TONE_CLASS[statusTone(m)]
                      }`}
                      title={m.isOutlier ? t("market.outlierHint") : undefined}
                    >
                      {statusLabel(m)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Узкий экран: карточка на рынок. Таблица в семь колонок на телефоне
          читается только боковой прокруткой, а прокрутки на сайте нет. */}
      <ul className="md:hidden space-y-2">
        {rows.map((m) => {
          const own = isOwnDexMarket(m);
          return (
            <li
              key={m.id}
              className={`border border-hairline rounded-[14px] p-3.5 ${own ? "bg-bg-tint" : "bg-card"}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">{exchangeCell(m, own)}</span>
                <span
                  className={`shrink-0 text-[10px] uppercase tracking-[0.1em] border rounded-full px-2 py-0.5 ${
                    TONE_CLASS[statusTone(m)]
                  }`}
                >
                  {statusLabel(m)}
                </span>
              </div>
              <div className="mt-1 text-center num text-[13px]">
                {m.pair}
                <span className="text-muted text-[11px]"> · {kindLabel(m)}</span>
              </div>
              {hasPrices && (
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-[0.12em] text-muted">
                      {t("market.price")}
                    </dt>
                    <dd className="num text-[13px] truncate">{price(m)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-[0.12em] text-muted">
                      {t("market.change24h")}
                    </dt>
                    <dd className={`num text-[13px] truncate ${changeClass(m)}`}>
                      {m.change24h != null ? formatPercent(m.change24h) : "—"}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-[0.12em] text-muted">
                      {t("market.volume24h")}
                    </dt>
                    <dd className="num text-[13px] truncate">{volume(m)}</dd>
                  </div>
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
