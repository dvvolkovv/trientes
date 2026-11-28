"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { addCryptoAddress, archiveCryptoAddress } from "@/app/actions/crypto-ledger";
import { ADMIN_BUTTON, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";

export type AddressRow = {
  id: string;
  coin: string;
  address: string;
  label: string | null;
  family: string | null;
  archived: boolean;
  /** Готовая строка «поступило»: число форматирует сервер, он знает язык страницы. */
  receivedText: string;
  sanctioned: boolean;
};

/**
 * Адреса получения (слайс CR). Пометка формата честная: семью сети мы знаем не у каждого
 * тикера, и «формат не проверен» сказано словами, а не выдано за проверку.
 */
export function AddressPanel({
  companyId,
  rows,
  canWrite,
}: {
  companyId: string;
  rows: AddressRow[];
  canWrite: boolean;
}) {
  const t = useTranslations("cabinetCrypto");
  const router = useRouter();
  const [coin, setCoin] = useState("");
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState(false);
  const [pending, start] = useTransition();

  const field = "w-full rounded-[10px] border border-hairline bg-card px-3 py-2 text-[16px] md:text-[14px]";
  const labelCls = "text-[12px] uppercase tracking-[0.14em] text-muted";

  function submit() {
    setError(null);
    setWarn(false);
    start(async () => {
      const res = await addCryptoAddress({ companyId, coin, address, label });
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setCoin("");
      setAddress("");
      setLabel("");
      if (res.sanctioned) setWarn(true);
      router.refresh();
    });
  }

  function toggle(id: string, archived: boolean) {
    start(async () => {
      const res = await archiveCryptoAddress({ companyId, addressId: id, archived });
      if (!res.ok) setError(res.reason);
      router.refresh();
    });
  }

  return (
    <section className="rounded-[14px] border border-hairline bg-card p-4">
      <h2 className="text-[15px] font-semibold">{t("addresses.heading")}</h2>
      <p className="mt-1 text-[12.5px] leading-snug text-muted">{t("addresses.hint")}</p>

      {rows.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">{t("addresses.empty")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-[12px] border border-hairline p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="num text-[13px] font-semibold">{row.coin}</span>
                {row.archived ? (
                  <span className="text-[11.5px] text-muted">{t("addresses.archived")}</span>
                ) : null}
              </div>
              <p className="num mt-1 break-all text-[12px] leading-snug">{row.address}</p>
              {row.label ? <p className="mt-1 text-[12.5px] text-muted">{row.label}</p> : null}
              <p className="mt-1 text-[11.5px] leading-snug text-muted">
                {row.family
                  ? t("addresses.checked", { family: t(`family.${row.family}` as never) })
                  : t("addresses.unchecked")}
                {" · "}
                {t("addresses.received", { amount: row.receivedText, coin: row.coin })}
              </p>
              {row.sanctioned ? (
                <p className="mt-2 rounded-[10px] bg-danger/10 px-2 py-1 text-[12px] font-semibold text-danger">
                  {t("sanctions.rowFlag")}
                </p>
              ) : null}
              {canWrite ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => toggle(row.id, !row.archived)}
                  className={`${ADMIN_BUTTON_SECONDARY} mt-2`}
                >
                  {row.archived ? t("addresses.restore") : t("addresses.archive")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <div className="mt-4 space-y-2 border-t border-hairline pt-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className={labelCls}>{t("form.coin")}</span>
              <input value={coin} onChange={(e) => setCoin(e.target.value)} placeholder="BTC" className={field} />
            </label>
            <label className="block space-y-1">
              <span className={labelCls}>{t("form.label")}</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} className={field} />
            </label>
          </div>
          <label className="block space-y-1">
            <span className={labelCls}>{t("form.address")}</span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
              className={field}
            />
          </label>
          {error ? <p className="text-[12.5px] leading-snug text-danger">{t(`error.${error}` as never)}</p> : null}
          {warn ? (
            <p className="text-[12.5px] font-semibold leading-snug text-danger">{t("sanctions.justAdded")}</p>
          ) : null}
          <button type="button" disabled={pending} onClick={submit} className={ADMIN_BUTTON}>
            {t("addresses.add")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
