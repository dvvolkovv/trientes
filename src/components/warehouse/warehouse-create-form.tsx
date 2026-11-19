"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createWarehouse } from "@/app/actions/warehouses";
import { WAREHOUSE_KINDS } from "@/lib/warehouse/rules";

export type ShelfPoint = { id: string; name: string; city: string | null };

/**
 * Заведение склада. Полка обязана где-то стоять: своя одобренная точка или онлайн —
 * иначе раздел «где взять» обещал бы покупателю место, которого нет.
 */
export function WarehouseCreateForm({
  companyId,
  points,
  scoped = false,
}: {
  companyId: string;
  points: ShelfPoint[];
  /// Сотрудник ограничен участком (слайс BE): склад он заводит только полкой на своей
  /// точке. Форма не предлагает того, что действие всё равно отвергнет.
  scoped?: boolean;
}) {
  const t = useTranslations("warehouses");
  const router = useRouter();
  const [kind, setKind] = useState<string>("SHELF");
  const [name, setName] = useState("");
  const [pointId, setPointId] = useState<string>("");
  const [online, setOnline] = useState(false);
  const [countryCode, setCountryCode] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const field = "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm";
  const label = "text-[12px] uppercase tracking-[0.14em] text-muted";
  const isShelf = kind === "SHELF";

  return (
    <div className="border border-hairline rounded-lg p-4 space-y-3">
      <h2 className="text-sm font-medium">{t("createHeading")}</h2>

      <div className="grid md:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className={label}>{t("kind")}</span>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              // Точка бывает только у полки: у оптового и стороннего склада её не может быть.
              if (e.target.value !== "SHELF") {
                setPointId("");
                setOnline(false);
              }
            }}
            className={field}
          >
            {(scoped ? WAREHOUSE_KINDS.filter((k) => k === "SHELF") : WAREHOUSE_KINDS).map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className={label}>{t("name")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </label>

        {isShelf ? (
          <label className="block space-y-1">
            <span className={label}>{t("point")}</span>
            <select
              value={pointId}
              onChange={(e) => {
                setPointId(e.target.value);
                if (e.target.value) setOnline(false);
              }}
              className={field}
            >
              {scoped ? null : <option value="">{t("pointNone")}</option>}
              {points.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.city ? `${p.name} — ${p.city}` : p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block space-y-1">
            <span className={label}>{t("countryCode")}</span>
            <input
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.toUpperCase().slice(0, 2))}
              placeholder="AT"
              className={`${field} num`}
            />
          </label>
        )}

        <label className="block space-y-1">
          <span className={label}>{t("address")}</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} className={field} />
        </label>
      </div>

      {isShelf ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={online}
            onChange={(e) => {
              setOnline(e.target.checked);
              if (e.target.checked) setPointId("");
            }}
          />
          {t("onlineShelf")}
        </label>
      ) : null}

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await createWarehouse(companyId, {
              kind,
              name,
              pointId: pointId || null,
              online,
              countryCode: countryCode || null,
              address: address || null,
              note: null,
            });
            if (r.ok) {
              setName("");
              setAddress("");
              router.refresh();
            } else {
              setError(r.reason);
            }
          });
        }}
        className="w-full md:w-auto h-12 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
      >
        {t("create")}
      </button>

      {error ? <p className="text-[13px] text-red-500">{t(`error.${error}`)}</p> : null}
    </div>
  );
}
