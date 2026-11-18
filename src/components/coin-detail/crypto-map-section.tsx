"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { MapFocus } from "@/lib/map-start";

// MapLibre touches `window`, so the navigator loads client-only.
const CryptoNavigator = dynamic(() => import("@/components/coin-detail/crypto-navigator"), {
  ssr: false,
  loading: () => (
    <div className="bg-card border border-hairline rounded-[20px] h-[520px] flex items-center justify-center text-muted text-sm">
      …
    </div>
  ),
});

export function CryptoMapSection({
  coinId,
  symbol,
  coinName,
  focus = null,
}: {
  coinId: string;
  symbol: string;
  coinName: string;
  /** Точка из адреса: карта открывается на ней. */
  focus?: MapFocus | null;
}) {
  const t = useTranslations("cryptoMap");
  return (
    <section>
      <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">{t("eyebrow")}</div>
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-1">{t("title")}</h2>
      <p className="text-muted text-[14px] mb-4 max-w-[680px]">{t("intro")}</p>
      {/* Ключ держит и точку: переход по ссылке на соседнее место той же
          монеты обязан пересобрать карту, иначе она осталась бы на прежнем. */}
      <CryptoNavigator
        key={`${coinId}|${focus?.id ?? ""}`}
        coinId={coinId}
        symbol={symbol}
        coinName={coinName}
        focus={focus}
      />
    </section>
  );
}
