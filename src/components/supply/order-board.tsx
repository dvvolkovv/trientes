"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  addOrderDoc,
  addOrderLine,
  cancelOrder,
  closeOrder,
  confirmOrder,
  declineOrder,
  markOrderShipped,
  receiveOrderLine,
  removeOrderLine,
  sendOrder,
} from "@/app/actions/supply";
import { canEditLines, canReceive, canTransition, isOrderClosed, remainingQty, type OrderSide, type OrderStatus } from "@/lib/supply/rules";
import { supplyDocUrl } from "@/lib/supply/docs";
import { effectiveOption } from "@/lib/supply/select";

export type BoardLine = {
  id: string;
  productName: string;
  productSlug: string;
  qty: number;
  receivedQty: number;
  price: number | null;
  unit: string;
};

export type BoardDoc = { name: string; filename: string; side: "buyer" | "supplier" };

export type BoardOrder = {
  id: string;
  status: OrderStatus;
  currency: string;
  lines: BoardLine[];
  docs: BoardDoc[];
  hasWarehouse: boolean;
  /** У поставщика есть кабинет на платформе. Без него статусы ведёт сам покупатель. */
  hasPortal: boolean;
};

export type BoardProduct = { id: string; name: string };

/**
 * Заказ глазами одной из двух сторон. Правила переходов берутся из того же модуля, что
 * проверяет их на сервере (`canTransition`): вторая копия правила в браузере разошлась
 * бы с первой — ровно то решение, что в доске задач BF.
 *
 * Нет ни одного доступного действия — пишем словами, **почему** (урок живых прогонов BF
 * и BG: погасшая кнопка без объяснения читается как поломка).
 */
export function OrderBoard({
  order,
  side,
  manage,
  products,
}: {
  order: BoardOrder;
  side: OrderSide;
  manage: boolean;
  products: BoardProduct[];
}) {
  const t = useTranslations("supply");
  const router = useRouter();
  const [productRaw, setProductId] = useState(products[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [eta, setEta] = useState("");
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState<"DECLINE" | "CANCEL" | "CLOSE" | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const field = "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm";
  const label = "text-[12px] uppercase tracking-[0.14em] text-muted";
  const btn = "h-12 px-4 rounded-md border border-hairline text-sm disabled:opacity-50";
  const primary = "h-12 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50";

  // Список товаров мог прийти позже формы — см. `effectiveOption`.
  const productId = effectiveOption(products.map((p) => p.id), productRaw);
  const linesEditable = manage && canEditLines(order.status, side);
  const receiving = manage && side === "BUYER" && canReceive(order.status) && order.hasWarehouse;
  // Ходы считает то же правило, что и сервер: вторая копия в браузере разошлась бы с
  // первой. У поставщика без портала ходы второй стороны делает сам покупатель.
  const hasPortal = order.hasPortal;
  const allow = (move: Parameters<typeof canTransition>[0]["move"]) =>
    manage && canTransition({ status: order.status, move, side, hasPortal });
  // Слова у этих двух кнопок разные: покупатель не выдаёт себя за поставщика, он
  // записывает то, что поставщик сказал по телефону.
  const selfDriven = side === "BUYER" && !hasPortal;

  const run = (fn: () => Promise<{ ok: boolean; reason?: string }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setReason("");
        setAsking(null);
        router.refresh();
      } else {
        setError(r.reason ?? "failed");
      }
    });
  };

  const anyAction =
    linesEditable ||
    receiving ||
    allow("SEND") ||
    allow("CONFIRM") ||
    allow("DECLINE") ||
    allow("SHIP") ||
    allow("CLOSE") ||
    allow("CANCEL");

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("linesHeading")}</h2>
        {order.lines.length === 0 ? (
          <p className="text-sm text-muted">{t("linesEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {order.lines.map((l) => {
              const left = remainingQty(l);
              return (
                <li key={l.id} className="border border-hairline rounded-lg p-3">
                  <div className="text-sm font-medium">{l.productName}</div>
                  <div className="text-[11px] text-muted num">
                    {t("lineQty", { qty: l.qty, unit: l.unit })}
                    {l.price !== null ? ` · ${l.price} ${order.currency}` : ""}
                    {l.receivedQty > 0 ? ` · ${t("lineReceived", { qty: l.receivedQty })}` : ""}
                  </div>

                  {linesEditable ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => removeOrderLine(order.id, l.id))}
                      className={`${btn} mt-3`}
                    >
                      {t("removeLine")}
                    </button>
                  ) : null}

                  {receiving && left > 0 ? (
                    <div className="flex flex-wrap items-end gap-2 mt-3">
                      <label className="block space-y-1">
                        <span className={label}>{t("receiveQty", { left })}</span>
                        <input
                          value={receiveQty[l.id] ?? ""}
                          onChange={(e) => setReceiveQty({ ...receiveQty, [l.id]: e.target.value })}
                          placeholder={String(left)}
                          className={`${field} num w-32`}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(async () => {
                            const r = await receiveOrderLine(order.id, l.id, receiveQty[l.id] || String(left));
                            // Принятое число в поле не оставляем: следующий привоз — своё число.
                            if (r.ok) setReceiveQty({ ...receiveQty, [l.id]: "" });
                            return r;
                          })
                        }
                        className={primary}
                      >
                        {t("receive")}
                      </button>
                    </div>
                  ) : null}
                  {receiving && left <= 0 ? <p className="text-[11px] text-muted mt-2">{t("lineFull")}</p> : null}
                </li>
              );
            })}
          </ul>
        )}

        {linesEditable ? (
          products.length === 0 ? (
            <p className="text-sm text-muted mt-3">{t("needProducts")}</p>
          ) : (
            <div className="border border-hairline rounded-lg p-4 space-y-3 mt-3">
              <div className="grid md:grid-cols-3 gap-3">
                <label className="block space-y-1">
                  <span className={label}>{t("product")}</span>
                  <select value={productId} onChange={(e) => setProductId(e.target.value)} className={field}>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className={label}>{t("qty")}</span>
                  <input value={qty} onChange={(e) => setQty(e.target.value)} className={`${field} num`} />
                </label>
                <label className="block space-y-1">
                  <span className={label}>{t("priceOptional", { currency: order.currency })}</span>
                  <input value={price} onChange={(e) => setPrice(e.target.value)} className={`${field} num`} />
                </label>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const r = await addOrderLine(order.id, { productId, qty, price: price || null, unit: "pcs", note: null });
                    if (r.ok) {
                      setQty("");
                      setPrice("");
                    }
                    return r;
                  })
                }
                className={primary}
              >
                {t("addLine")}
              </button>
              {/* Платежа у нас нет, и цена в заказе справочная: обещать расчёт нельзя. */}
              <p className="text-[11px] text-muted">{t("paymentOutside")}</p>
            </div>
          )
        ) : null}
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("docsHeading")}</h2>
        {order.docs.length === 0 ? (
          <p className="text-sm text-muted">{t("docsEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {order.docs.map((d) => (
              <li key={d.name} className="border border-hairline rounded-lg p-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{d.filename}</div>
                  <div className="text-[11px] text-muted">{t(`docSide.${d.side}`)}</div>
                </div>
                <a href={supplyDocUrl(order.id, d.name)} target="_blank" rel="noreferrer" className={btn}>
                  {t("openDoc")}
                </a>
              </li>
            ))}
          </ul>
        )}
        {manage ? <DocUpload orderId={order.id} /> : null}
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("actionsHeading")}</h2>
        {/* Закрытый заказ — не «ход другой стороны», её хода уже не будет: третья фраза,
            а не две (тот же разбор, что `summaryClosed` в AP). */}
        {!anyAction ? (
          <p className="text-sm text-muted">
            {isOrderClosed(order.status) ? t("closedNoActions") : manage ? t("noActions") : t("readOnly")}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {allow("SEND") ? (
            <button type="button" disabled={pending} onClick={() => run(() => sendOrder(order.id))} className={primary}>
              {t("moves.SEND")}
            </button>
          ) : null}
          {allow("CONFIRM") ? (
            <>
              {/* Поле даты без подписи в живом прогоне читалось пустым полем: подпись
                  обязательна, как у поля приёмки. */}
              <input
                type="date"
                aria-label={t("confirmedEta")}
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                className={`${field} num w-44`}
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => confirmOrder(order.id, eta || null))}
                className={primary}
              >
                {t(selfDriven ? "moves.CONFIRM_SELF" : "moves.CONFIRM")}
              </button>
            </>
          ) : null}
          {allow("SHIP") ? (
            <button type="button" disabled={pending} onClick={() => run(() => markOrderShipped(order.id))} className={primary}>
              {t(selfDriven ? "moves.SHIP_SELF" : "moves.SHIP")}
            </button>
          ) : null}
          {allow("DECLINE") ? (
            <button type="button" onClick={() => setAsking("DECLINE")} className={btn}>
              {t("moves.DECLINE")}
            </button>
          ) : null}
          {allow("CLOSE") ? (
            <button type="button" onClick={() => setAsking("CLOSE")} className={btn}>
              {t("moves.CLOSE")}
            </button>
          ) : null}
          {allow("CANCEL") ? (
            <button type="button" onClick={() => setAsking("CANCEL")} className={btn}>
              {t("moves.CANCEL")}
            </button>
          ) : null}
        </div>

        {/* Почему кнопки поставщика здесь у покупателя — говорим прямо, иначе это
            выглядит как чужие кнопки на своём экране. */}
        {selfDriven && anyAction ? <p className="text-[11px] text-muted mt-2">{t("selfDrivenHint")}</p> : null}

        {asking ? (
          <div className="border border-hairline rounded-lg p-4 space-y-3 mt-3">
            <label className="block space-y-1">
              <span className={label}>{t("reason")}</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    asking === "DECLINE"
                      ? declineOrder(order.id, reason)
                      : asking === "CANCEL"
                        ? cancelOrder(order.id, reason)
                        : closeOrder(order.id, reason),
                  )
                }
                className={primary}
              >
                {t(`moves.${asking}`)}
              </button>
              <button type="button" onClick={() => setAsking(null)} className={btn}>
                {t("cancel")}
              </button>
            </div>
          </div>
        ) : null}

        {receiving && !order.hasWarehouse ? <p className="text-[13px] text-muted mt-2">{t("needWarehouse")}</p> : null}
        {error ? <p className="text-[13px] text-red-500 mt-2">{t(`error.${error}`)}</p> : null}
      </section>
    </div>
  );
}

/** Накладная грузится тем же путём, что вложения переписки: файл приватный. */
function DocUpload({ orderId }: { orderId: string }) {
  const t = useTranslations("supply");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="mt-3">
      <label className="inline-flex items-center h-12 px-4 rounded-md border border-hairline text-sm cursor-pointer">
        {busy ? t("uploading") : t("addDoc")}
        <input
          type="file"
          className="hidden"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError(null);
            try {
              const form = new FormData();
              form.set("orderId", orderId);
              form.set("file", file);
              const res = await fetch("/api/supply-doc/upload", { method: "POST", body: form });
              const data = (await res.json()) as { ok?: boolean; error?: string; name?: string; filename?: string; size?: number; mime?: string };
              if (!data.ok || !data.name) {
                setError(data.error ?? "failed");
              } else {
                const r = await addOrderDoc(orderId, {
                  name: data.name,
                  filename: data.filename ?? file.name,
                  size: data.size ?? file.size,
                  mime: data.mime ?? file.type,
                });
                if (r.ok) router.refresh();
                else setError(r.reason);
              }
            } catch {
              setError("failed");
            } finally {
              setBusy(false);
              e.target.value = "";
            }
          }}
        />
      </label>
      {error ? <p className="text-[13px] text-red-500 mt-2">{t(`error.${error}`)}</p> : null}
    </div>
  );
}
