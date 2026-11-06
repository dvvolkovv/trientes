"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { transferCoinCard, disableCoinMultisig } from "@/app/actions/admin-coin-revisions";

export type OwnershipCard = {
  id: string;
  name: string;
  symbol: string;
  slug: string;
  steward: string | null;
  trust: string;
  multisig: boolean;
  threshold: number;
  signers: number;
};

/**
 * The two emergency levers a site admin has over a published card: hand it to
 * the real project, and switch off a multisig whose signers are gone. Both are
 * audit-logged and surface in the card's public history.
 */
export function CoinCardOwnershipRow({ card }: { card: OwnershipCard }) {
  const t = useTranslations("admin.coinOwnership");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [identifier, setIdentifier] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; reason?: string }>, okKey: string) {
    setError(null);
    setDone(null);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setDone(okKey);
        router.refresh();
      } else {
        setError(r.reason ?? "unknown");
      }
    });
  }

  return (
    <div className="border border-hairline rounded-lg p-4 bg-card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{card.name}</span>
        <span className="num text-xs text-muted">{card.symbol}</span>
        <span className="text-[11px] px-2 py-0.5 rounded bg-bg-tint">{card.trust}</span>
        <span className="text-[11px] text-muted">
          {t("steward", { steward: card.steward ?? "—" })}
        </span>
        <span className="text-[11px] text-muted">
          {card.multisig
            ? t("multisigOn", { m: card.threshold, n: card.signers })
            : t("multisigOff")}
        </span>
        <a
          href={`/ru/coin/${card.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] underline text-muted ml-auto"
        >
          /{card.slug} ↗
        </a>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder={t("identifierPlaceholder")}
          className="flex-1 min-w-[180px] px-3 py-1.5 rounded-md border border-hairline bg-bg-tint text-xs"
        />
        <button
          type="button"
          disabled={pending || identifier.trim().length < 2}
          onClick={() => run(() => transferCoinCard({ cardId: card.id, identifier }), "transferred")}
          className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-medium disabled:opacity-50"
        >
          {t("transfer")}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("reasonPlaceholder")}
          className="flex-1 min-w-[180px] px-3 py-1.5 rounded-md border border-hairline bg-bg-tint text-xs"
        />
        <button
          type="button"
          disabled={pending || !card.multisig || reason.trim().length < 3}
          onClick={() => run(() => disableCoinMultisig(card.id, reason), "multisigDisabled")}
          className="px-3 py-1.5 rounded-md border border-hairline text-red-500 text-xs font-medium disabled:opacity-50"
        >
          {t("disableMultisig")}
        </button>
      </div>

      {error ? <p className="text-red-500 text-xs">{t(`errors.${error}`)}</p> : null}
      {done ? <p className="text-green-500 text-xs">{t(`done.${done}`)}</p> : null}
    </div>
  );
}
