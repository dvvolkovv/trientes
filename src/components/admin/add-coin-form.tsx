"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { addAdminCoin } from "@/app/actions/admin-coins";

export function AddCoinForm() {
  const t = useTranslations("admin");
  const router = useRouter();
  const [coingeckoId, setCoingeckoId] = useState("");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const inputClass =
    "bg-bg-tint border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none w-full";
  const labelClass =
    "text-[10px] uppercase tracking-[0.18em] text-muted block mb-1.5";

  return (
    <form
      className="bg-card border border-hairline rounded-[20px] p-5 md:p-6 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setDone(false);
        start(async () => {
          const res = await addAdminCoin({ coingeckoId, symbol, name });
          if (res.ok) {
            setDone(true);
            setCoingeckoId("");
            setSymbol("");
            setName("");
            router.refresh();
          } else {
            setError(res.reason ?? "unknown_error");
          }
        });
      }}
    >
      <div className="flex-1 min-w-[150px]">
        <label className={labelClass}>{t("addCoin.coingeckoId")}</label>
        <input
          type="text"
          value={coingeckoId}
          onChange={(e) => setCoingeckoId(e.target.value)}
          required
          placeholder="e.g. solana"
          className={inputClass}
        />
      </div>
      <div className="w-24">
        <label className={labelClass}>{t("addCoin.symbol")}</label>
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          required
          maxLength={12}
          className={inputClass}
        />
      </div>
      <div className="flex-1 min-w-[150px]">
        <label className={labelClass}>{t("addCoin.name")}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={inputClass}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-accent-foreground rounded-md px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:brightness-110 disabled:opacity-50"
      >
        {pending ? t("addCoin.adding") : t("addCoin.add")}
      </button>
      {error && <p className="text-down text-sm w-full">{t(`errors.${error}`)}</p>}
      {done && <p className="text-up text-sm w-full">{t("addCoin.added")}</p>}
    </form>
  );
}
