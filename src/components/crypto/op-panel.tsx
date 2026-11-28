"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { deleteCryptoOp, recordCryptoOp } from "@/app/actions/crypto-ledger";
import { CRYPTO_OP_KINDS } from "@/lib/crypto-ledger/rules";
import { ADMIN_BUTTON, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";

export type OpRow = {
  id: string;
  kind: string;
  coin: string;
  /** Готовые строки: числа форматирует сервер — он знает язык страницы. */
  amountText: string;
  fiatText: string | null;
  rateText: string | null;
  currency: string;
  day: string;
  address: string | null;
  txHash: string | null;
  note: string | null;
  authorName: string | null;
  /** Сверка курса с нашей ценой того часа: готовая строка или `null`. */
  rateNote: string | null;
  rateOff: boolean;
  sanctioned: boolean;
};

/**
 * Книга операций (слайс CR). Фиатная сумма **выводится** из курса, а не набирается
 * рядом: два числа, которые обязаны сходиться, расходятся в первый же день.
 */
export function OpPanel({
  companyId,
  rows,
  currencies,
  defaultCurrency,
  today,
  canWrite,
}: {
  companyId: string;
  rows: OpRow[];
  currencies: readonly string[];
  /** Валюта, в которой предприятие уже получало монету: подставлять первую из списка
   * значит заставить бухгалтера менять её каждый раз. */
  defaultCurrency: string;
  today: string;
  canWrite: boolean;
}) {
  const t = useTranslations("cabinetCrypto");
  const router = useRouter();
  const [kind, setKind] = useState<string>("CONVERSION");
  const [coin, setCoin] = useState("");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [day, setDay] = useState(today);
  const [address, setAddress] = useState("");
  const [txHash, setTxHash] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const field = "w-full rounded-[10px] border border-hairline bg-card px-3 py-2 text-[16px] md:text-[14px]";
  const labelCls = "text-[12px] uppercase tracking-[0.14em] text-muted";

  function submit() {
    setError(null);
    start(async () => {
      const res = await recordCryptoOp({
        companyId,
        kind,
        coin,
        amount,
        rate,
        currency,
        happenedAt: day,
        address,
        txHash,
        note,
      });
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setCoin("");
      setAmount("");
      setRate("");
      setAddress("");
      setTxHash("");
      setNote("");
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await deleteCryptoOp({ companyId, opId: id });
      if (!res.ok) setError(res.reason);
      router.refresh();
    });
  }

  return (
    <section className="rounded-[14px] border border-hairline bg-card p-4">
      <h2 className="text-[15px] font-semibold">{t("ops.heading")}</h2>
      <p className="mt-1 text-[12.5px] leading-snug text-muted">{t("ops.hint")}</p>

      {rows.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">{t("ops.empty")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-[12px] border border-hairline p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold">{t(`kind.${row.kind}` as never)}</span>
                <span className="num text-[12px] text-muted">{row.day}</span>
              </div>
              <p className="num mt-1 text-[13px]">
                {row.amountText} {row.coin}
                {row.fiatText ? ` · ${row.fiatText}` : ""}
                {/* Валюту печатает сам форматированный курс — второй раз её не пишем
                    (живой прогон показал «по 57 289,00 € EUR за монету»). */}
                {row.rateText ? ` · ${t("ops.atRate", { rate: row.rateText })}` : ""}
              </p>
              {row.rateNote ? (
                <p className={`mt-1 text-[11.5px] leading-snug ${row.rateOff ? "text-danger" : "text-muted"}`}>
                  {row.rateNote}
                </p>
              ) : null}
              {row.address ? <p className="num mt-1 break-all text-[11.5px] text-muted">{row.address}</p> : null}
              {row.txHash ? <p className="num mt-1 break-all text-[11.5px] text-muted">{row.txHash}</p> : null}
              {row.note ? <p className="mt-1 text-[12.5px] leading-snug">{row.note}</p> : null}
              {row.sanctioned ? (
                <p className="mt-2 rounded-[10px] bg-danger/10 px-2 py-1 text-[12px] font-semibold text-danger">
                  {t("sanctions.rowFlag")}
                </p>
              ) : null}
              {row.authorName ? (
                <p className="mt-1 text-[11.5px] text-muted">{t("ops.author", { name: row.authorName })}</p>
              ) : null}
              {canWrite ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => remove(row.id)}
                  className={`${ADMIN_BUTTON_SECONDARY} mt-2`}
                >
                  {t("ops.delete")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <div className="mt-4 space-y-2 border-t border-hairline pt-3">
          <div className="flex flex-wrap gap-2">
            {CRYPTO_OP_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`min-h-11 rounded-[12px] border px-3 text-[13px] font-medium ${
                  kind === k ? "border-accent text-accent" : "border-hairline hover:border-accent"
                }`}
              >
                {t(`kind.${k}` as never)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className={labelCls}>{t("form.coin")}</span>
              <input value={coin} onChange={(e) => setCoin(e.target.value)} placeholder="BTC" className={field} />
            </label>
            <label className="block space-y-1">
              <span className={labelCls}>{t("form.amount")}</span>
              <input
                value={amount}
                inputMode="decimal"
                onChange={(e) => setAmount(e.target.value)}
                className={field}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className={labelCls}>{t("form.rate")}</span>
              <input value={rate} inputMode="decimal" onChange={(e) => setRate(e.target.value)} className={field} />
            </label>
            <label className="block space-y-1">
              <span className={labelCls}>{t("form.currency")}</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={field}>
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-1">
            <span className={labelCls}>{t("form.day")}</span>
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={field} />
          </label>
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
          <label className="block space-y-1">
            <span className={labelCls}>{t("form.txHash")}</span>
            <input
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
              className={field}
            />
          </label>
          <label className="block space-y-1">
            <span className={labelCls}>{t("form.note")}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
          </label>
          {error ? <p className="text-[12.5px] leading-snug text-danger">{t(`error.${error}` as never)}</p> : null}
          <button type="button" disabled={pending} onClick={submit} className={ADMIN_BUTTON}>
            {t("ops.add")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
