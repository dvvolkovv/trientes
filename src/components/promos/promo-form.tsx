"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createPromo } from "@/app/actions/promos";
import { PROMO_TEXT_MAX } from "@/lib/promos/rules";

/**
 * Заведение акции. Ссылок в тексте нет — так и сказано под полем: ссылка в сообщении от
 * незнакомого магазина это дверь для фишинга, а придёт сообщение из нашего бота.
 */
export function PromoForm({
  companyId,
  points,
  products,
}: {
  companyId: string;
  points: { id: string; label: string }[];
  products: { id: string; label: string }[];
}) {
  const t = useTranslations("cabinetPromos");
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [startsAt, setStartsAt] = useState(today);
  const [endsAt, setEndsAt] = useState(today);
  const [productId, setProductId] = useState("");
  const [pointId, setPointId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const field = "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm";
  const label = "text-[11px] uppercase tracking-wider text-muted mb-1 block";

  return (
    <section className="border border-hairline rounded-md p-4 mb-8">
      <h2 className="text-[16px] font-semibold mb-3">{t("newTitle")}</h2>
      <div className="space-y-3">
        <div>
          <label className={label} htmlFor="promo-title">{t("fieldTitle")}</label>
          <input id="promo-title" className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="promo-body">{t("fieldBody")}</label>
          <textarea
            id="promo-body"
            className={`${field} min-h-[96px]`}
            value={body}
            maxLength={PROMO_TEXT_MAX}
            onChange={(e) => setBody(e.target.value)}
          />
          <p className="text-[11px] text-muted mt-1">{t("noLinks")}</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="promo-from">{t("fieldFrom")}</label>
            <input id="promo-from" type="date" className={field} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="promo-to">{t("fieldTo")}</label>
            <input id="promo-to" type="date" className={field} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="promo-product">{t("fieldProduct")}</label>
            <select id="promo-product" className={field} value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">{t("noLink")}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="promo-point">{t("fieldPoint")}</label>
            <select id="promo-point" className={field} value={pointId} onChange={(e) => setPointId(e.target.value)}>
              <option value="">{t("noLink")}</option>
              {points.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>
        {error ? <p className="text-sm text-red-500">{t(`error.${error}`)}</p> : null}
        <button
          type="button"
          className="h-12 px-4 rounded-md border border-hairline text-sm hover:border-accent disabled:opacity-50"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await createPromo(companyId, {
                title,
                body,
                startsAt,
                endsAt,
                productId: productId || null,
                pointId: pointId || null,
              });
              if (r.ok) {
                setTitle("");
                setBody("");
                setProductId("");
                setPointId("");
                router.refresh();
              } else {
                setError(r.reason);
              }
            })
          }
        >
          {t("create")}
        </button>
      </div>
    </section>
  );
}
