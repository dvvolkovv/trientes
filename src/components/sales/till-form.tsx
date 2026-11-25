"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { recordSale } from "@/app/actions/sales";
import { QrButton } from "@/components/qr-button";
import { ShareButton } from "@/components/share-button";
import {
  SALE_PAYMENTS,
  MAX_SALE_LINES,
  isService,
  parseQty,
  saleTotals,
  type SaleLineValue,
} from "@/lib/sales/rules";
import { parseAmount } from "@/lib/products/offers-rules";

export type TillItem = {
  productId: string;
  name: string;
  unit: string;
  currency: string;
  listPrice: number;
  cashbackPercent: number | null;
  /** Услуга: остатка у неё нет вовсе, и это не ноль. */
  service: boolean;
};

export type TillShelf = { id: string; name: string; pointName: string | null };

type Draft = { productId: string; qty: string; price: string };

/**
 * Касса. Цена подставляется из предложения продавца и может быть **понижена** — продажа
 * по согласованной цене бывает; скидка тогда выводится вычитанием, а не вводится вторым
 * числом. Поднять выше витринной нельзя: витрина — обещание покупателю.
 *
 * Суммы на экране считает та же `saleTotals`, что пишет чек: вторая формула в браузере
 * разошлась бы с серверной, и человек увидел бы не то, что записано.
 */
export function TillForm({
  companyId,
  locale,
  shelves,
  items,
  stock,
}: {
  companyId: string;
  locale: string;
  shelves: TillShelf[];
  items: TillItem[];
  /** Остатки по полкам: `stock[полка][товар]`. */
  stock: Record<string, Record<string, number>>;
}) {
  const t = useTranslations("cabinetSales");
  const unit = useTranslations("offers.units");
  const router = useRouter();
  const [shelfId, setShelfId] = useState(shelves[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<Draft[]>([]);
  const [payment, setPayment] = useState<string>("CASH");
  const [coin, setCoin] = useState("");
  const [rate, setRate] = useState("");
  const [coinAmount, setCoinAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ number: number; url: string; id: string } | null>(null);
  const [pending, start] = useTransition();

  const byId = useMemo(() => new Map(items.map((i) => [i.productId, i])), [items]);
  const chosen = useMemo(() => new Set(lines.map((l) => l.productId)), [lines]);
  // Уже набранное в подсказках не предлагается: второй раз тот же товар — это
  // количество в его строке, а не вторая строка (правило `duplicate_line`).
  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = items.filter((i) => !chosen.has(i.productId));
    if (!q) return pool.slice(0, 8);
    return pool.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 8);
  }, [items, query, chosen]);

  /** Предпросмотр сумм: те же правила, что на сервере. */
  const preview = useMemo(() => {
    const values: SaleLineValue[] = [];
    for (const l of lines) {
      const item = byId.get(l.productId);
      if (!item) continue;
      const qty = parseQty(l.qty) ?? 0;
      const typed = l.price.trim();
      const price = typed ? (parseAmount(typed) ?? item.listPrice) : item.listPrice;
      const sum = Math.round(price * qty * 100) / 100;
      values.push({
        productId: item.productId,
        name: item.name,
        unit: item.unit,
        qty,
        listPrice: item.listPrice,
        price: Math.min(price, item.listPrice),
        cashbackPercent: item.cashbackPercent,
        cashbackAmount: item.cashbackPercent ? Math.round(((sum * item.cashbackPercent) / 100) * 100) / 100 : 0,
        stocked: !isService(item.unit),
      });
    }
    const currency = values[0] ? byId.get(values[0].productId)!.currency : (items[0]?.currency ?? "EUR");
    return saleTotals(currency, values);
  }, [lines, byId, items]);

  const money = (value: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: preview.currency }).format(value);

  const field =
    "w-full rounded-[10px] border border-hairline bg-card px-3 py-2 text-[16px] md:text-[14px]";
  const label = "text-[12px] uppercase tracking-[0.14em] text-muted";

  function add(productId: string) {
    if (lines.length >= MAX_SALE_LINES) return;
    setLines((prev) => [...prev, { productId, qty: "1", price: "" }]);
    setQuery("");
    setError(null);
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await recordSale(companyId, locale, {
        warehouseId: shelfId || null,
        lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, price: l.price })),
        payment,
        payCoin: payment === "CRYPTO" ? coin : null,
        payRate: payment === "CRYPTO" ? rate : null,
        payCoinAmount: payment === "CRYPTO" ? coinAmount : null,
        payNote: null,
        note: note || null,
      });
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setDone({ number: res.number, url: res.url, id: res.id });
      setLines([]);
      setNote("");
      setCoin("");
      setRate("");
      setCoinAmount("");
      router.refresh();
    });
  }

  if (done) {
    return (
      <div className="rounded-[14px] border border-hairline bg-card p-4">
        <h2 className="text-[15px] font-semibold">{t("doneHeading", { number: done.number })}</h2>
        <p className="mt-1 text-[12.5px] leading-snug text-muted">{t("doneHint")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <QrButton
            text={done.url}
            className="min-h-12 flex-1 rounded-[12px] border border-hairline px-4 text-[13px] font-medium hover:border-accent"
          />
          <ShareButton
            payload={{ title: t("shareTitle"), text: t("shareText", { number: done.number }), url: done.url }}
            className="min-h-12 flex-1 rounded-[12px] border border-hairline px-4 text-[13px] font-medium hover:border-accent"
          />
        </div>
        <p className="mt-2 break-all text-[11px] leading-snug text-muted">{done.url}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/${locale}/cabinet/companies/${companyId}/sales/${done.id}`}
            className="min-h-12 flex-1 rounded-[12px] border border-hairline px-4 text-[13px] font-medium flex items-center justify-center hover:border-accent"
          >
            {t("openReceipt")}
          </Link>
          <button
            type="button"
            onClick={() => setDone(null)}
            className="min-h-12 flex-1 rounded-[12px] bg-accent px-4 text-[13px] font-semibold text-background"
          >
            {t("newSale")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-hairline bg-card p-4">
      <h2 className="text-[15px] font-semibold">{t("tillHeading")}</h2>

      {shelves.length > 0 ? (
        <label className="mt-3 block space-y-1">
          <span className={label}>{t("shelf")}</span>
          <select value={shelfId} onChange={(e) => setShelfId(e.target.value)} className={field}>
            <option value="">{t("noShelf")}</option>
            {shelves.map((s) => (
              <option key={s.id} value={s.id}>
                {s.pointName ? `${s.name} · ${s.pointName}` : s.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="mt-3 text-[12.5px] leading-snug text-muted">{t("noShelves")}</p>
      )}

      <label className="mt-3 block space-y-1">
        <span className={label}>{t("find")}</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("findPlaceholder")}
          className={field}
        />
      </label>

      {found.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {found.map((i) => (
            <li key={i.productId}>
              <button
                type="button"
                onClick={() => add(i.productId)}
                className="min-h-12 w-full rounded-[10px] border border-hairline px-3 text-left text-[13px] hover:border-accent"
              >
                <span className="block truncate">{i.name}</span>
                <span className="block text-[11.5px] text-muted num">
                  {new Intl.NumberFormat(locale, { style: "currency", currency: i.currency }).format(i.listPrice)}
                  {" / "}
                  {unit(i.unit)}
                  {i.service
                    ? ` · ${t("serviceLine")}`
                    : ` · ${t("onShelf", { qty: stock[shelfId]?.[i.productId] ?? 0 })}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className="mt-2 text-[12.5px] leading-snug text-muted">{t("noOffers")}</p>
      ) : null}

      {lines.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2 border-t border-hairline pt-3">
          {lines.map((l, idx) => {
            const item = byId.get(l.productId);
            if (!item) return null;
            return (
              <li key={l.productId} className="rounded-[10px] border border-hairline p-2">
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px]">{item.name}</span>
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                    className="min-h-11 shrink-0 rounded-[10px] border border-hairline px-3 text-[12px] text-muted hover:border-accent"
                  >
                    {t("removeLine")}
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="block space-y-1">
                    <span className={label}>{t("qty")}</span>
                    <input
                      value={l.qty}
                      inputMode="decimal"
                      onChange={(e) =>
                        setLines((prev) => prev.map((p, i) => (i === idx ? { ...p, qty: e.target.value } : p)))
                      }
                      className={field}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className={label}>{t("price")}</span>
                    <input
                      value={l.price}
                      inputMode="decimal"
                      placeholder={String(item.listPrice)}
                      onChange={(e) =>
                        setLines((prev) => prev.map((p, i) => (i === idx ? { ...p, price: e.target.value } : p)))
                      }
                      className={field}
                    />
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <fieldset className="mt-4 border-t border-hairline pt-3">
        <legend className={label}>{t("payment")}</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SALE_PAYMENTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPayment(p)}
              aria-pressed={payment === p}
              className={`min-h-12 rounded-[10px] border px-3 text-[13px] ${
                payment === p ? "border-accent text-accent" : "border-hairline hover:border-accent"
              }`}
            >
              {t(`paymentKind.${p}`)}
            </button>
          ))}
        </div>
      </fieldset>

      {payment === "CRYPTO" ? (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className={label}>{t("coin")}</span>
              <input value={coin} onChange={(e) => setCoin(e.target.value)} placeholder="BTC" className={field} />
            </label>
            <label className="block space-y-1">
              <span className={label}>{t("coinAmount")}</span>
              <input
                value={coinAmount}
                inputMode="decimal"
                onChange={(e) => setCoinAmount(e.target.value)}
                className={field}
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className={label}>{t("rate")}</span>
            <input value={rate} inputMode="decimal" onChange={(e) => setRate(e.target.value)} className={field} />
          </label>
          <p className="text-[11.5px] leading-snug text-muted">{t("coinStated")}</p>
        </div>
      ) : null}

      <label className="mt-3 block space-y-1">
        <span className={label}>{t("note")}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
      </label>

      <dl className="mt-4 space-y-1 border-t border-hairline pt-3 text-[13px]">
        {preview.discount > 0 ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t("discount")}</dt>
            <dd className="num">−{money(preview.discount)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3 text-[16px] font-semibold">
          <dt>{t("total")}</dt>
          <dd className="num">{money(preview.total)}</dd>
        </div>
        {preview.cashbackTotal > 0 ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t("cashback")}</dt>
            <dd className="num">{money(preview.cashbackTotal)}</dd>
          </div>
        ) : null}
      </dl>

      {error ? <p className="mt-3 text-[12.5px] leading-snug text-danger">{t(`error.${error}`)}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={pending || lines.length === 0}
        className="mt-3 min-h-12 w-full rounded-[12px] bg-accent px-4 text-[14px] font-semibold text-background disabled:opacity-50"
      >
        {pending ? t("saving") : t("record")}
      </button>
    </div>
  );
}
