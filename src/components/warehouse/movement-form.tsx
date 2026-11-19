"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { recordMovement } from "@/app/actions/warehouses";
import { MOVE_KINDS } from "@/lib/warehouse/rules";

export type MoveWarehouse = { id: string; name: string; kind: string };
export type MoveProduct = { id: string; name: string };

/**
 * Движение склада. Перевозчик — не украшение: названный перевозчик превращает
 * перемещение в путь, и товар списывается с источника, но приёмнику не зачисляется,
 * пока его не приняли.
 */
export function MovementForm({
  companyId,
  warehouses,
  products,
  defaultWarehouseId,
}: {
  companyId: string;
  warehouses: MoveWarehouse[];
  products: MoveProduct[];
  defaultWarehouseId?: string;
}) {
  const t = useTranslations("warehouses");
  const router = useRouter();
  const [kind, setKind] = useState<string>("RECEIPT");
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [fromId, setFromId] = useState(defaultWarehouseId ?? "");
  const [toId, setToId] = useState(defaultWarehouseId ?? "");
  const [qty, setQty] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [expected, setExpected] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const field = "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm";
  const label = "text-[12px] uppercase tracking-[0.14em] text-muted";

  const needsFrom = kind === "ISSUE" || kind === "TRANSFER";
  const needsTo = kind === "RECEIPT" || kind === "TRANSFER" || kind === "ADJUST";
  const isTransfer = kind === "TRANSFER";

  return (
    <div className="border border-hairline rounded-lg p-4 space-y-3">
      <h2 className="text-sm font-medium">{t("moveHeading")}</h2>

      <div className="grid md:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className={label}>{t("moveKind")}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
            {MOVE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`moveKinds.${k}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className={label}>{t("product")}</span>
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className={field}>
            {products.length === 0 ? <option value="">{t("noProducts")}</option> : null}
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        {needsFrom ? (
          <label className="block space-y-1">
            <span className={label}>{t("from")}</span>
            <select value={fromId} onChange={(e) => setFromId(e.target.value)} className={field}>
              <option value="">—</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {needsTo ? (
          <label className="block space-y-1">
            <span className={label}>{kind === "ADJUST" ? t("warehouse") : t("to")}</span>
            <select value={toId} onChange={(e) => setToId(e.target.value)} className={field}>
              <option value="">—</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="block space-y-1">
          <span className={label}>{t("qty")}</span>
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={`${field} num`} />
        </label>

        {isTransfer ? (
          <>
            <label className="block space-y-1">
              <span className={label}>{t("carrier")}</span>
              <input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder={t("carrierPlaceholder")}
                className={field}
              />
            </label>
            <label className="block space-y-1">
              <span className={label}>{t("tracking")}</span>
              <input value={tracking} onChange={(e) => setTracking(e.target.value)} className={`${field} num`} />
            </label>
            <label className="block space-y-1">
              <span className={label}>{t("expectedAt")}</span>
              <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className={field} />
            </label>
          </>
        ) : null}

        <label className="block space-y-1 md:col-span-2">
          <span className={label}>{kind === "ADJUST" ? t("reason") : t("note")}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </label>
      </div>

      {isTransfer ? <p className="text-[11px] text-muted">{t("carrierNote")}</p> : null}
      {kind === "ADJUST" ? <p className="text-[11px] text-muted">{t("adjustNote")}</p> : null}

      <button
        type="button"
        disabled={pending || !productId}
        onClick={() => {
          setError(null);
          setDone(null);
          start(async () => {
            const r = await recordMovement(companyId, {
              kind,
              productId,
              fromWarehouseId: needsFrom ? fromId || null : null,
              toWarehouseId: needsTo ? toId || null : null,
              qty,
              carrierName: isTransfer ? carrier || null : null,
              trackingCode: isTransfer ? tracking || null : null,
              expectedAt: isTransfer && expected ? expected : null,
              note: note || null,
            });
            if (r.ok) {
              setQty("");
              setNote("");
              setDone(r.status === "IN_TRANSIT" ? "transit" : "done");
              router.refresh();
            } else {
              setError(r.reason);
            }
          });
        }}
        className="w-full md:w-auto h-12 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
      >
        {t("record")}
      </button>

      {done ? <p className="text-[13px] text-accent">{t(`recorded.${done}`)}</p> : null}
      {error ? <p className="text-[13px] text-red-500">{t(`error.${error}`)}</p> : null}
    </div>
  );
}
