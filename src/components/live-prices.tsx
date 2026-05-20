"use client";

import { useEffect } from "react";
import { formatPriceInCurrency, type Currency } from "@/lib/currency";
import type { ExchangeRates } from "@/lib/coingecko";

type Tick = { coinId: string; price: number; ts: number };

export function LivePrices({
  currency,
  rates,
}: {
  currency: Currency;
  rates: ExchangeRates | null;
}) {
  useEffect(() => {
    const es = new EventSource("/api/stream/prices");
    es.addEventListener("price", (e) => {
      try {
        const tick = JSON.parse((e as MessageEvent).data) as Tick;
        // Find every cell that opted in to live updates for this coin.
        document.querySelectorAll<HTMLElement>(`[data-live-price="${tick.coinId}"]`).forEach((el) => {
          el.textContent = rates
            ? formatPriceInCurrency(tick.price, currency, rates)
            : `$${tick.price.toFixed(2)}`;
          el.classList.add("live-flash");
          window.setTimeout(() => el.classList.remove("live-flash"), 500);
        });
      } catch {
        /* ignore */
      }
    });
    return () => es.close();
  }, [currency, rates]);
  return null;
}
