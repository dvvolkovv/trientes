"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { sendPromo, setPromoArchived } from "@/app/actions/promos";
import { CRM_SEGMENTS, type CrmSegment } from "@/lib/crm/segments";

export type PromoRow = {
  id: string;
  title: string;
  body: string;
  state: "upcoming" | "running" | "finished";
  window: string;
  archived: boolean;
  sent: boolean;
  followers: number;
  delivered: number;
  skipped: number;
  clicks: number;
  productSlug: string | null;
};

/**
 * Список акций с рассылкой и числами. Рассылка по акции делается **один раз** — после
 * неё кнопки нет вовсе, а не «нажмите, и мы откажем»: обманка хуже отказа (правило BE).
 *
 * Показов в числах нет намеренно: честно считает их только счётчик в браузере, которого
 * у нас нет, а приписать показ акции просмотру страницы — врать.
 */
export function PromoList({
  promos,
  editable,
  sendBlocked,
  locale,
}: {
  promos: PromoRow[];
  editable: boolean;
  /**
   * Почему рассылать нельзя, или `null`. Погасшая кнопка без слов — тот самый дефект,
   * который живой прогон BF поймал у задачи «на проверке»: человек смотрит на серую
   * кнопку и не знает, в нём дело или в нас.
   */
  sendBlocked: "daily_cap" | "not_listed" | null;
  locale: string;
}) {
  const t = useTranslations("cabinetPromos");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; reason: string } | null>(null);
  const [done, setDone] = useState<{ id: string; delivered: number; skipped: number } | null>(null);
  // Сегмент выбирается один на экран, а не на строку: рассылка в сутки одна, и две
  // строки с разными сегментами означали бы выбор, который всё равно не состоится.
  const [segment, setSegment] = useState<CrmSegment | "">("");
  const [, start] = useTransition();

  if (promos.length === 0) return <p className="text-sm text-muted">{t("empty")}</p>;

  const button = "h-12 px-4 rounded-md border border-hairline text-sm hover:border-accent disabled:opacity-50";

  return (
    <ul className="space-y-3">
      {promos.map((p) => (
        <li key={p.id} className={`border border-hairline rounded-md p-3 ${p.archived ? "opacity-60" : ""}`}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="font-medium">{p.title}</div>
              <p className="text-sm whitespace-pre-wrap text-muted mt-0.5">{p.body}</p>
            </div>
            <div className="text-[11px] text-muted text-right shrink-0">
              <div>{p.window}</div>
              <div>{t(`state.${p.archived ? "archived" : p.state}`)}</div>
            </div>
          </div>

          {p.sent ? (
            <p className="text-[11px] text-muted mt-2">
              {t("sentNumbers", {
                followers: p.followers,
                delivered: p.delivered,
                skipped: p.skipped,
                clicks: p.clicks,
              })}
            </p>
          ) : (
            <p className="text-[11px] text-muted mt-2">{t("notSent", { clicks: p.clicks })}</p>
          )}

          {error?.id === p.id ? <p className="text-sm text-red-500 mt-2">{t(`error.${error.reason}`)}</p> : null}
          {done?.id === p.id ? (
            <p className="text-sm mt-2">{t("sendDone", { delivered: done.delivered, skipped: done.skipped })}</p>
          ) : null}

          {editable ? (
            <div className="flex flex-wrap gap-2 mt-3">
              {!p.sent && !p.archived && p.state === "running" ? (
                <button
                  type="button"
                  className={button}
                  disabled={busy === p.id || sendBlocked !== null}
                  onClick={() =>
                    start(async () => {
                      setBusy(p.id);
                      setError(null);
                      setDone(null);
                      const r = await sendPromo(p.id, segment || null);
                      setBusy(null);
                      if (r.ok) {
                        setDone({ id: p.id, delivered: r.delivered, skipped: r.skipped });
                        router.refresh();
                      } else {
                        setError({ id: p.id, reason: r.reason });
                      }
                    })
                  }
                >
                  {segment ? t("sendToSegment", { segment: t(`segment.${segment}`) }) : t("send")}
                </button>
              ) : null}
              {!p.sent && !p.archived && p.state === "running" ? (
                <select
                  aria-label={t("segmentLabel")}
                  className="h-12 rounded-md border border-hairline bg-card px-3 text-sm"
                  value={segment}
                  onChange={(e) => setSegment((e.target.value as CrmSegment) || "")}
                >
                  <option value="">{t("segmentAll")}</option>
                  {CRM_SEGMENTS.map((key) => (
                    <option key={key} value={key}>
                      {t(`segment.${key}`)}
                    </option>
                  ))}
                </select>
              ) : null}
              {!p.sent && !p.archived && p.state === "running" && sendBlocked ? (
                <p className="text-[11px] text-muted self-center">{t(`sendBlocked.${sendBlocked}`)}</p>
              ) : null}
              <button
                type="button"
                className={button}
                disabled={busy === p.id}
                onClick={() =>
                  start(async () => {
                    setBusy(p.id);
                    setError(null);
                    const r = await setPromoArchived(p.id, !p.archived);
                    setBusy(null);
                    if (r.ok) router.refresh();
                    else setError({ id: p.id, reason: r.reason });
                  })
                }
              >
                {p.archived ? t("restore") : t("archive")}
              </button>
              {p.productSlug ? (
                <a href={`/${locale}/product/${p.productSlug}`} className={button}>
                  {t("openProduct")}
                </a>
              ) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
