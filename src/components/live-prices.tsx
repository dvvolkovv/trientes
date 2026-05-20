"use client";

import { useEffect, useRef } from "react";
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
  const prev = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const es = new EventSource("/api/stream/prices");
    es.addEventListener("price", (e) => {
      try {
        const tick = JSON.parse((e as MessageEvent).data) as Tick;
        const before = prev.current.get(tick.coinId);
        const direction =
          before === undefined ? "up" : tick.price > before ? "up" : tick.price < before ? "down" : null;
        prev.current.set(tick.coinId, tick.price);

        document
          .querySelectorAll<HTMLElement>(`[data-live-price="${tick.coinId}"]`)
          .forEach((el) => {
            el.textContent = rates
              ? formatPriceInCurrency(tick.price, currency, rates)
              : `$${tick.price.toFixed(2)}`;
            if (direction) {
              const cls = `live-flash-${direction}`;
              el.classList.add(cls);
              window.setTimeout(() => el.classList.remove(cls), 700);
            }
          });
      } catch {
        /* ignore */
      }
    });
    return () => es.close();
  }, [currency, rates]);
  return null;
}
