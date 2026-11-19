"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { deleteReorderRule, saveReorderRule } from "@/app/actions/supply";
import { effectiveOption } from "@/lib/supply/select";

export type RuleRow = {
  id: string;
  warehouseName: string;
  productName: string;
  supplierName: string;
  minQty: number;
  targetQty: number;
  onHand: number;
};

export type RuleOption = { id: string; name: string };

/**
 * Правила автозаказа. Прогон по ним **формирует черновик** и уведомляет тех, кто вправе
 * заказывать: отправка — обещание купить, и её делает человек. Поставщик у правила
 * обязателен — заявку иначе некому адресовать.
 */
export function ReorderRules({
  companyId,
  rows,
  warehouses,
  products,
  suppliers,
  editable,
}: {
  companyId: string;
  rows: RuleRow[];
  warehouses: RuleOption[];
  products: RuleOption[];
  suppliers: RuleOption[];
  editable: boolean;
}) {
  const t = useTranslations("supply");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [warehouseRaw, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [productRaw, setProductId] = useState(products[0]?.id ?? "");
  const [supplierRaw, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [minQty, setMinQty] = useState("");
  const [targetQty, setTargetQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const field = "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm";
  const label = "text-[12px] uppercase tracking-[0.14em] text-muted";
  // Списки могли прийти позже формы — см. `effectiveOption`.
  const warehouseId = effectiveOption(warehouses.map((w) => w.id), warehouseRaw);
  const productId = effectiveOption(products.map((p) => p.id), productRaw);
  const supplierId = effectiveOption(suppliers.map((s) => s.id), supplierRaw);

  return (
    <section className="mb-10">
      <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">{t("rulesHeading")}</h2>
      <p className="text-sm text-muted mb-3">{t("rulesIntro")}</p>

      {rows.length === 0 ? (
        <p className="text-sm text-muted mb-3">{t("rulesEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2 mb-3">
          {rows.map((r) => (
            <li key={r.id} className="border border-hairline rounded-lg p-3">
              <div className="text-sm font-medium">{r.productName}</div>
              <div className="text-[11px] text-muted num">
                {r.warehouseName} · {t("ruleThreshold", { min: r.minQty, target: r.targetQty })} ·{" "}
                {t("ruleOnHand", { qty: r.onHand })} · {r.supplierName}
              </div>
              {editable ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    start(async () => {
                      const res = await deleteReorderRule(companyId, r.id);
                      if (res.ok) router.refresh();
                      else setError(res.reason);
                    });
                  }}
                  className="h-12 px-4 rounded-md border border-hairline text-sm mt-3 disabled:opacity-50"
                >
                  {t("deleteRule")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        suppliers.length === 0 || warehouses.length === 0 || products.length === 0 ? (
          <p className="text-sm text-muted">{t("rulesNeedParts")}</p>
        ) : open ? (
          <div className="border border-hairline rounded-lg p-4 space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className={label}>{t("warehouse")}</span>
                <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={field}>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
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
                <span className={label}>{t("minQty")}</span>
                <input value={minQty} onChange={(e) => setMinQty(e.target.value)} className={`${field} num`} />
              </label>
              <label className="block space-y-1">
                <span className={label}>{t("targetQty")}</span>
                <input value={targetQty} onChange={(e) => setTargetQty(e.target.value)} className={`${field} num`} />
              </label>
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
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const res = await saveReorderRule(companyId, { warehouseId, productId, supplierId, minQty, targetQty });
                    if (res.ok) {
                      setMinQty("");
                      setTargetQty("");
                      setOpen(false);
                      router.refresh();
                    } else {
                      setError(res.reason);
                    }
                  });
                }}
                className="h-12 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
              >
                {t("save")}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="h-12 px-4 rounded-md border border-hairline text-sm">
                {t("cancel")}
              </button>
            </div>
            {error ? <p className="text-[13px] text-red-500">{t(`error.${error}`)}</p> : null}
          </div>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="h-12 px-4 rounded-md border border-hairline text-sm">
            {t("addRule")}
          </button>
        )
      ) : null}
      {!open && error ? <p className="text-[13px] text-red-500 mt-2">{t(`error.${error}`)}</p> : null}
    </section>
  );
}
