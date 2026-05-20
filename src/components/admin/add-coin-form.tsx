"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  return (
    <form
      className="flex flex-wrap items-end gap-2 border rounded-lg p-4"
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
        <label className="text-xs text-muted-foreground">{t("addCoin.coingeckoId")}</label>
        <Input value={coingeckoId} onChange={(e) => setCoingeckoId(e.target.value)} required placeholder="e.g. solana" />
      </div>
      <div className="w-24">
        <label className="text-xs text-muted-foreground">{t("addCoin.symbol")}</label>
        <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} required maxLength={12} />
      </div>
      <div className="flex-1 min-w-[150px]">
        <label className="text-xs text-muted-foreground">{t("addCoin.name")}</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? t("addCoin.adding") : t("addCoin.add")}
      </Button>
      {error && <p className="text-sm text-red-500 w-full">{t(`errors.${error}`)}</p>}
      {done && <p className="text-sm text-green-600 w-full">{t("addCoin.added")}</p>}
    </form>
  );
}
