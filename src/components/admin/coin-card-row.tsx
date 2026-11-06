"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { approveCoinCard, rejectCoinCard } from "@/app/actions/admin-coin-cards";

type Card = {
  id: string;
  slug: string;
  name: string;
  symbol: string;
  tagline: string | null;
  logoUrl: string | null;
  completeness: number;
  createdAt: string;
  steward: { username: string | null; name: string | null; email: string | null } | null;
  contracts: Array<{ id: string; chain: string; address: string; isCanonical: boolean }>;
  markets: Array<{ id: string; kind: string; exchangeName: string; pair: string }>;
};

const MIN_REASON = 3;

export function CoinCardRow({ card }: { card: Card }) {
  const t = useTranslations("admin.coinCards");
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; reason?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.reason ?? "unknown_error");
    });

  const author = card.steward?.username ?? card.steward?.name ?? card.steward?.email ?? "—";

  return (
    <div className="border border-hairline rounded-md p-4 bg-card">
      <div className="flex items-start gap-4">
        {card.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.logoUrl} alt="" width={48} height={48}
            className="rounded-full border border-hairline shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">
            {card.name} <span className="text-muted">{card.symbol}</span>
          </h3>
          {card.tagline && <p className="text-muted text-sm">{card.tagline}</p>}
          <p className="text-muted text-xs mt-1">
            /{card.slug} · {t("completeness")}: {card.completeness}% · {author} ·{" "}
            {new Date(card.createdAt).toISOString().slice(0, 10)}
          </p>
        </div>
      </div>

      {card.contracts.length > 0 && (
        <ul className="mt-3 space-y-1">
          {card.contracts.map((c) => (
            <li key={c.id} className="text-xs font-mono text-muted break-all">
              {c.chain}: {c.address}
              {c.isCanonical && <span className="ml-2 text-accent">★</span>}
            </li>
          ))}
        </ul>
      )}

      {card.markets.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          {card.markets.map((m) => `${m.exchangeName} ${m.pair}`).join(" · ")}
        </p>
      )}

      <div className="mt-4 flex flex-col sm:flex-row gap-3 sm:items-center">
        <button type="button" disabled={pending}
          onClick={() => run(() => approveCoinCard(card.id))}
          className="bg-up/15 text-up border border-up/40 rounded-md px-4 py-2 text-sm font-semibold uppercase tracking-wider disabled:opacity-50">
          {t("approve")}
        </button>
        <input value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={t("rejectReason")} maxLength={500}
          className="flex-1 bg-background border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted outline-none focus:ring-1 focus:ring-accent" />
        <button type="button" disabled={pending || reason.trim().length < MIN_REASON}
          onClick={() => run(() => rejectCoinCard(card.id, reason))}
          className="bg-down/15 text-down border border-down/40 rounded-md px-4 py-2 text-sm font-semibold uppercase tracking-wider disabled:opacity-50">
          {t("reject")}
        </button>
      </div>

      {error && <p className="text-down text-sm mt-2">{t(`errors.${error}`)}</p>}
    </div>
  );
}
