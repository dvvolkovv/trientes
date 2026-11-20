import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { LadderStep } from "@/lib/products/ladder";

/**
 * Лестница настройки товара на экране (слайс BM). Ступень — не кнопка «сделать за
 * меня», а указатель: куда идти и почему это пока ничего не изменит.
 */
export async function ProductLadder({
  steps,
  hrefs,
  done,
  total,
}: {
  steps: LadderStep[];
  /** Куда ведёт каждая ступень. Пусто — ступень на этой же странице. */
  hrefs: Partial<Record<string, string>>;
  done: number;
  total: number;
}) {
  const t = await getTranslations("cabinetProducts.ladder");

  return (
    <section className="rounded-[22px] border border-hairline bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted">{t("heading")}</h2>
        <span className="num text-[13px] text-muted">{t("progress", { done, total })}</span>
      </div>
      <ol className="space-y-2">
        {steps.map((step, i) => {
          const href = hrefs[step.key];
          const mark = step.state === "done" ? "✓" : step.state === "blocked" ? "–" : String(i + 1);
          const tone =
            step.state === "done"
              ? "border-up/40 bg-up/10 text-up"
              : step.state === "blocked"
                ? "border-hairline bg-bg-tint text-muted"
                : "border-accent/40 bg-accent/10 text-accent";
          const body = (
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[12px] font-bold ${tone}`}
              >
                {mark}
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold leading-tight">{t(`step.${step.key}`)}</div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-muted">
                  {step.state === "done"
                    ? t(`doneHint.${step.key}`)
                    : step.state === "blocked"
                      ? t("blocked", { step: t(`step.${step.blockedBy ?? "offer"}`) })
                      : step.missing && step.missing.length > 0
                        ? t("missing", { list: step.missing.map((m) => t(`need.${m}`)).join(", ") })
                        : t(`todoHint.${step.key}`)}
                </div>
              </div>
            </div>
          );
          return (
            <li key={step.key}>
              {href ? (
                <Link
                  href={href}
                  className="block rounded-[14px] border border-hairline p-3 transition-colors hover:border-accent/60"
                >
                  {body}
                </Link>
              ) : (
                <div className="rounded-[14px] border border-hairline p-3">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
