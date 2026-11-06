import { getTranslations } from "next-intl/server";
import { getPublicCardHistory } from "@/lib/coin-card-history";

function short(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

/** Public, by design: who changed what, when, from what to what. */
export async function CardHistorySection({ cardId }: { cardId: string }) {
  const t = await getTranslations("coinCard.history");
  const items = await getPublicCardHistory(cardId);
  if (items.length === 0) return null;

  return (
    <section id="history" className="py-10 border-t border-hairline">
      <div className="num text-[11px] uppercase tracking-[0.18em] text-muted mb-2">
        {t("kicker")}
      </div>
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.02em] mb-1">
        {t("title")}
      </h2>
      <p className="text-sm text-muted mb-5">{t("subtitle")}</p>

      <ul className="space-y-3">
        {items.map((it) => (
          <li key={it.id} className="border border-hairline rounded-md p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="num text-[11px] text-muted">{it.at.slice(0, 10)}</span>
              {it.kind === "revision" ? (
                <>
                  <span className="num text-[11px] uppercase tracking-[0.12em]">
                    {it.isPolicy ? t("policyChange") : t(`section.${it.section}`)}
                  </span>
                  <span className="text-[11px] text-muted">{t("by", { author: it.author })}</span>
                </>
              ) : (
                <span className="text-[11px] uppercase tracking-[0.12em] text-accent">
                  {t(`admin.${it.action}`)}
                </span>
              )}
            </div>
            {it.kind === "revision" ? (
              <ul className="space-y-1">
                {it.diff.slice(0, 6).map((e) => (
                  <li key={e.path} className="text-xs text-muted">
                    <span className="num">{e.path}</span>: {short(e.before)} → {short(e.after)}
                  </li>
                ))}
                {it.diff.length > 6 ? (
                  <li className="text-xs text-muted">{t("more", { count: it.diff.length - 6 })}</li>
                ) : null}
              </ul>
            ) : it.reason ? (
              <p className="text-xs text-muted">{it.reason}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
