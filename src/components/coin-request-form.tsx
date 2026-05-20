"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitCoinRequest } from "@/app/actions/coin-request";

export function CoinRequestForm() {
  const t = useTranslations("request");
  const router = useRouter();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [coingeckoId, setCoingeckoId] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await submitCoinRequest({ name, symbol, coingeckoId, reason });
          if (res.ok) {
            setDone(true);
            setName("");
            setSymbol("");
            setCoingeckoId("");
            setReason("");
            router.refresh();
          } else {
            setError(res.reason ?? "unknown_error");
          }
        });
      }}
    >
      <div>
        <Label htmlFor="rq-name">{t("name")}</Label>
        <Input id="rq-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
      </div>
      <div>
        <Label htmlFor="rq-symbol">{t("symbol")}</Label>
        <Input id="rq-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} required maxLength={12} />
      </div>
      <div>
        <Label htmlFor="rq-cg">{t("coingeckoIdOptional")}</Label>
        <Input
          id="rq-cg"
          value={coingeckoId}
          onChange={(e) => setCoingeckoId(e.target.value)}
          placeholder="e.g. bitcoin"
          maxLength={80}
        />
      </div>
      <div>
        <Label htmlFor="rq-reason">{t("reason")}</Label>
        <textarea
          id="rq-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          minLength={5}
          maxLength={2000}
          rows={4}
          className="w-full border rounded-md p-2 text-sm bg-background"
        />
      </div>
      {error && <p className="text-red-500 text-sm">{t(`errors.${error}`)}</p>}
      {done && <p className="text-green-600 text-sm">{t("submitted")}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
