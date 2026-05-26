import Image from "next/image";
import { getTranslations } from "next-intl/server";
import type { Exchange } from "@/lib/coingecko";

function trustBadgeCls(score: number | null): string {
  if (score === null) return "bg-card-alt text-muted";
  if (score >= 9) return "bg-up/15 text-up";
  if (score >= 7) return "bg-accent/15 text-accent";
  return "bg-down/15 text-down";
}

export async function ExchangeCardHeader({ exchange }: { exchange: Exchange }) {
  const t = await getTranslations("exchangeCard");
  return (
    <header className="flex items-start gap-5">
      {exchange.logoUrl && (
        <Image src={exchange.logoUrl} alt="" width={72} height={72} className="rounded-xl flex-shrink-0" unoptimized />
      )}
      <div className="flex-1 min-w-0">
        <h1 className="text-[28px] font-semibold leading-tight">{exchange.name}</h1>
        <div className="flex flex-wrap gap-2 mt-2 items-center">
          {exchange.exchangeType && (
            <span className="text-[10px] uppercase tracking-[0.18em] bg-card-alt px-2 py-1 rounded-sm">
              {exchange.exchangeType}
            </span>
          )}
          {exchange.country && (
            <span className="text-[13px] text-muted">{exchange.country}</span>
          )}
          {exchange.yearEstablished && (
            <span className="num text-[13px] text-muted">· {exchange.yearEstablished}</span>
          )}
          <span className={`num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium ${trustBadgeCls(exchange.trustScore)}`}>
            {exchange.trustScore ?? t("noData")}/10
          </span>
        </div>
      </div>
    </header>
  );
}
