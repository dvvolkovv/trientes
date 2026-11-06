"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { saveCoinCardSection } from "@/app/actions/coin-card";
import { Field, inputCls, labelCls, btnCls } from "./field";

type MarketRow = {
  kind: "CEX" | "DEX";
  exchangeName: string;
  pair: string;
  tradeUrl: string;
  chain: string;
  poolAddress: string;
};

const EMPTY_MARKET: MarketRow = {
  kind: "CEX", exchangeName: "", pair: "", tradeUrl: "", chain: "", poolAddress: "",
};

const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function StepTokenomics({
  cardId,
  onSaved,
}: {
  cardId: string;
  onSaved: (completeness: number, missing: string[]) => void;
}) {
  const t = useTranslations("coinCard.wizard");
  const [circulating, setCirculating] = useState("");
  const [total, setTotal] = useState("");
  const [max, setMax] = useState("");
  const [excluded, setExcluded] = useState("");
  const [emission, setEmission] = useState("");
  const [burn, setBurn] = useState("");
  const [markets, setMarkets] = useState<MarketRow[]>([{ ...EMPTY_MARKET }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const patch = (i: number, p: Partial<MarketRow>) =>
    setMarkets((ms) => ms.map((m, j) => (j === i ? { ...m, ...p } : m)));

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const first = await saveCoinCardSection({
            cardId,
            section: "TOKENOMICS",
            payload: {
              tokenomics: {
                circulating: num(circulating),
                total: num(total),
                max: num(max),
                excludedAddresses: excluded.split("\n").map((s) => s.trim()).filter(Boolean),
                emission: emission.trim() || null,
                burnMechanism: burn.trim() || null,
              },
            },
          });
          // Stop on the first failure — do not half-save the step.
          if (!first.ok) {
            setError(first.reason);
            return;
          }
          const rows = markets.filter((m) => m.exchangeName.trim() && m.pair.trim());
          const second = await saveCoinCardSection({
            cardId, section: "MARKETS", payload: { markets: rows },
          });
          if (second.ok) onSaved(second.completeness, second.missing);
          else setError(second.reason);
        });
      }}
    >
      <div className="grid sm:grid-cols-3 gap-4">
        <Field id="cc-circ" label={t("circulating")}>
          <input id="cc-circ" value={circulating} inputMode="decimal" className={inputCls}
            onChange={(e) => setCirculating(e.target.value)} />
        </Field>
        <Field id="cc-total" label={t("totalSupply")}>
          <input id="cc-total" value={total} inputMode="decimal" className={inputCls}
            onChange={(e) => setTotal(e.target.value)} />
        </Field>
        <Field id="cc-max" label={t("maxSupply")}>
          <input id="cc-max" value={max} inputMode="decimal" className={inputCls}
            onChange={(e) => setMax(e.target.value)} />
        </Field>
      </div>
      <Field id="cc-excluded" label={t("excludedAddresses")} hint={t("excludedAddressesHint")}>
        <textarea id="cc-excluded" value={excluded} rows={4} className={`${inputCls} font-mono`}
          onChange={(e) => setExcluded(e.target.value)} />
      </Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field id="cc-emission" label={t("emission")}>
          <input id="cc-emission" value={emission} className={inputCls}
            onChange={(e) => setEmission(e.target.value)} />
        </Field>
        <Field id="cc-burn" label={t("burnMechanism")}>
          <input id="cc-burn" value={burn} className={inputCls}
            onChange={(e) => setBurn(e.target.value)} />
        </Field>
      </div>

      <div className="pt-2">
        <span className={labelCls}>{t("marketsLabel")}</span>
        <p className="text-muted text-xs mb-4">{t("marketsHint")}</p>
        <div className="space-y-4">
          {markets.map((m, i) => (
            <div key={i} className="border border-hairline rounded-md p-4 space-y-4">
              <div className="flex items-center justify-between">
                <select value={m.kind} className={`${inputCls} max-w-[120px]`}
                  onChange={(e) => patch(i, { kind: e.target.value as "CEX" | "DEX" })}>
                  <option value="CEX">CEX</option>
                  <option value="DEX">DEX</option>
                </select>
                {markets.length > 1 && (
                  <button type="button" className="text-down text-xs"
                    onClick={() => setMarkets((ms) => ms.filter((_, j) => j !== i))}>
                    {t("remove")}
                  </button>
                )}
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field id={`cc-ex-${i}`} label={t("exchangeName")}>
                  <input id={`cc-ex-${i}`} value={m.exchangeName} className={inputCls}
                    onChange={(e) => patch(i, { exchangeName: e.target.value })} />
                </Field>
                <Field id={`cc-pair-${i}`} label={t("pair")}>
                  <input id={`cc-pair-${i}`} value={m.pair} placeholder="FOO/USDT" className={inputCls}
                    onChange={(e) => patch(i, { pair: e.target.value })} />
                </Field>
              </div>
              <Field id={`cc-trade-${i}`} label={t("tradeUrl")}>
                <input id={`cc-trade-${i}`} value={m.tradeUrl} className={inputCls}
                  onChange={(e) => patch(i, { tradeUrl: e.target.value })} />
              </Field>
              {m.kind === "DEX" && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field id={`cc-mchain-${i}`} label={t("chain")}>
                    <input id={`cc-mchain-${i}`} value={m.chain} className={inputCls}
                      onChange={(e) => patch(i, { chain: e.target.value })} />
                  </Field>
                  <Field id={`cc-pool-${i}`} label={t("poolAddress")}>
                    <input id={`cc-pool-${i}`} value={m.poolAddress} className={`${inputCls} font-mono`}
                      onChange={(e) => patch(i, { poolAddress: e.target.value })} />
                  </Field>
                </div>
              )}
            </div>
          ))}
        </div>
        {markets.length < 200 && (
          <button type="button" className="text-accent text-sm mt-4"
            onClick={() => setMarkets((ms) => [...ms, { ...EMPTY_MARKET }])}>
            + {t("addMarket")}
          </button>
        )}
      </div>

      {error && <p className="text-down text-sm">{t(`errors.${error}`)}</p>}
      <button type="submit" disabled={pending} className={btnCls}>
        {pending ? t("saving") : t("next")}
      </button>
    </form>
  );
}
