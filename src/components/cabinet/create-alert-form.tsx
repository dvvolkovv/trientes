"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createPriceAlert } from "@/app/actions/price-alerts";

type Coin = { id: string; symbol: string; name: string; logoUrl: string | null };

export function CreateAlertForm({ coins }: { coins: Coin[] }) {
  const t = useTranslations("cabinet.alerts");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [coinId, setCoinId] = useState<string>(coins[0]?.id ?? "");
  const [op, setOp] = useState<"GTE" | "LTE">("GTE");
  const [threshold, setThreshold] = useState("");
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return coins.slice(0, 50);
    return coins
      .filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.id.includes(q))
      .slice(0, 50);
  }, [coins, query]);

  const picked = coins.find((c) => c.id === coinId);

  return (
    <form
      className="border border-hairline rounded-[16px] p-4 space-y-3 bg-card"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const num = Number(threshold);
        if (!Number.isFinite(num) || num <= 0) {
          setError("invalid");
          return;
        }
        const c = coins.find((x) => x.id === coinId);
        if (!c) {
          setError("unknown_coin");
          return;
        }
        startTransition(async () => {
          const r = await createPriceAlert({ coinId: c.id, symbol: c.symbol, op, threshold: num });
          if (r.ok) {
            setThreshold("");
            router.refresh();
          } else {
            setError(r.reason);
          }
        });
      }}
    >
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">{t("add")}</h3>

      <div className="grid sm:grid-cols-[1fr_auto_1fr_auto] gap-2 items-stretch">
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("coinSearchPlaceholder")}
            className="w-full px-3 py-2 rounded-md border border-hairline bg-bg-tint text-sm"
          />
          {query && filtered.length > 0 ? (
            <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-hairline bg-card shadow-lg">
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setCoinId(c.id);
                      setQuery(`${c.symbol.toUpperCase()} — ${c.name}`);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-bg-tint"
                  >
                    {c.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.logoUrl} alt="" className="h-5 w-5 rounded-full" loading="lazy" />
                    ) : (
                      <div className="h-5 w-5 rounded-full bg-bg-tint" />
                    )}
                    <span className="font-medium">{c.symbol.toUpperCase()}</span>
                    <span className="text-muted truncate">{c.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <select
          value={op}
          onChange={(e) => setOp(e.target.value as "GTE" | "LTE")}
          className="px-3 py-2 rounded-md border border-hairline bg-bg-tint text-sm"
        >
          <option value="GTE">≥</option>
          <option value="LTE">≤</option>
        </select>

        <input
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          placeholder={t("thresholdPlaceholder")}
          className="px-3 py-2 rounded-md border border-hairline bg-bg-tint text-sm"
        />

        <button
          type="submit"
          disabled={pending || !picked || !threshold}
          className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
        >
          {pending ? t("submitting") : t("submit")}
        </button>
      </div>

      {picked ? (
        <p className="text-[11px] text-muted">
          {t("pickedHint", { symbol: picked.symbol.toUpperCase(), name: picked.name })}
        </p>
      ) : null}

      {error ? <p className="text-red-500 text-sm">{t(`errors.${error}`)}</p> : null}
    </form>
  );
}
