"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createOrder } from "@/app/actions/supply";
import { effectiveOption } from "@/lib/supply/select";

export type OrderFormOption = { id: string; name: string };

/**
 * Заведение заказа. Склад назначения необязателен только на бумаге: без него нечего
 * принимать, и приёмка откажет вслух (`warehouse_required`) — поэтому поле стоит первым
 * после поставщика.
 */
export function OrderCreateForm({
  companyId,
  suppliers,
  warehouses,
  currency,
}: {
  companyId: string;
  suppliers: OrderFormOption[];
  warehouses: OrderFormOption[];
  currency: string;
}) {
  const t = useTranslations("supply");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supplierRaw, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [warehouseRaw, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [expected, setExpected] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const field = "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm";
  const label = "text-[12px] uppercase tracking-[0.14em] text-muted";
  // Список мог прийти позже формы: что стоит на экране, то и уходит в действие.
  const supplierId = effectiveOption(suppliers.map((s) => s.id), supplierRaw);
  const warehouseId = warehouses.some((w) => w.id === warehouseRaw) ? warehouseRaw : "";

  if (suppliers.length === 0) return <p className="text-sm text-muted">{t("needSupplier")}</p>;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-12 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium"
      >
        {t("newOrder")}
      </button>
    );
  }

  return (
    <div className="border border-hairline rounded-lg p-4 space-y-3">
      <div className="grid md:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className={label}>{t("supplier")}</span>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={field}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className={label}>{t("warehouse")}</span>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={field}>
            <option value="">{t("warehouseNone")}</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className={label}>{t("expectedAt")}</span>
          <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className={`${field} num`} />
        </label>
        <label className="block space-y-1">
          <span className={label}>{t("note")}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              const r = await createOrder(companyId, {
                supplierId,
                warehouseId: warehouseId || null,
                expectedDate: expected || null,
                currency,
                note: note || null,
              });
              if (r.ok) router.push(`./supply/${r.id}`);
              else setError(r.reason);
            });
          }}
          className="h-12 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
        >
          {t("create")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-12 px-4 rounded-md border border-hairline text-sm">
          {t("cancel")}
        </button>
      </div>
      {error ? <p className="text-[13px] text-red-500">{t(`error.${error}`)}</p> : null}
    </div>
  );
}
