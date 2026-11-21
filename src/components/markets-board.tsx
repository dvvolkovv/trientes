import { getTranslations } from "next-intl/server";
import type { MarketQuote, MarketGroup, MarketUnit } from "@/lib/markets";

// Metal/energy names are translated; index names are proper nouns shown as-is.
const I18N_NAMES = new Set(["gold", "silver", "platinum", "palladium", "crude", "natgas"]);

function fmt(n: number | null, unit: MarketUnit): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const s = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return unit === "usd" ? `$${s}` : s;
}

const GROUP_ORDER: MarketGroup[] = ["index", "energy", "metal"];
const GROUP_KEY: Record<MarketGroup, string> = {
  index: "indices",
  energy: "energy",
  metal: "metals",
};

export async function MarketsBoard({ quotes }: { quotes: MarketQuote[] }) {
  const t = await getTranslations("markets");
  if (quotes.length === 0) {
    return (
      <div className="bg-card border border-hairline rounded-[20px] p-12 text-center">
        <p className="text-muted">{t("empty")}</p>
      </div>
    );
  }

  const asOf = quotes.map((q) => `${q.date ?? ""} ${q.time ?? ""}`.trim()).sort().pop() ?? "";
  // Подпись «As of» под табло называет самую свежую карточку, а карточки у нас
  // разного возраста: металлы свежие на минуту, ряды FRED отстают на день
  // (индексы) и на несколько дней (нефть и газ — спот публикуется с
  // задержкой). Поэтому отставшая карточка носит свою дату: один штамп на
  // всё табло выдавал бы цену прошлой недели за сегодняшнюю.
  const asOfDate = asOf.slice(0, 10);
  const label = (q: MarketQuote) => (I18N_NAMES.has(q.name) ? t(q.name) : q.name);

  return (
    <div className="space-y-10">
      {GROUP_ORDER.map((group) => {
        const rows = quotes.filter((q) => q.group === group);
        if (rows.length === 0) return null;
        return (
          <section key={group}>
            <h2 className="text-[13px] uppercase tracking-[0.22em] text-muted mb-4">{t(GROUP_KEY[group])}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {rows.map((q) => {
                const up = (q.changePct ?? 0) >= 0;
                return (
                  <div key={q.symbol} className="bg-card border border-hairline rounded-[16px] p-4">
                    <div className="text-[13px] text-muted truncate">{label(q)}</div>
                    <div className="num text-[22px] font-semibold mt-1">{fmt(q.last, q.unit)}</div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[12px]">
                      {q.changePct !== null && (
                        <span className={`num font-medium ${up ? "text-up" : "text-down"}`}>
                          {up ? "+" : ""}
                          {q.changePct.toFixed(2)}%
                        </span>
                      )}
                      {(q.low !== null || q.high !== null) && (
                        // Размах дня есть только у Nasdaq: ряды FRED его не
                        // содержат, служба металлов отдаёт одну цену. «— – —»
                        // в карточке — не «размах неизвестен», а мусор.
                        <span className="num text-muted">
                          {fmt(q.low, q.unit)} – {fmt(q.high, q.unit)}
                        </span>
                      )}
                      {q.date && q.date !== asOfDate && (
                        <span className="num text-muted/60">{q.date}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="text-[11px] text-muted/60 leading-relaxed">
        {t("dataNote")}
        {asOf && (
          <>
            {" "}
            <span className="num">
              {t("asOf")} {asOf} UTC
            </span>
          </>
        )}
      </p>
    </div>
  );
}
