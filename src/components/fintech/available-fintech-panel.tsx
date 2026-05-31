"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

type Item = {
  id: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  services: string[];
};

// Side-panel that lists fintech companies advertising service in the country the
// map is currently centered on. Reverse-geocodes the center via the existing
// /api/crypto-map/geocode endpoint (cached server-side) and then fetches the
// public /api/fintech/available?cc=… feed (also cached server-side).
export function AvailableFintechPanel({
  center,
}: {
  center: { lat: number; lon: number } | null;
}) {
  const t = useTranslations("fintech.panel");
  const locale = useLocale();
  const [cc, setCc] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCcRef = useRef<string | null>(null);

  useEffect(() => {
    if (!center) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const geoRes = await fetch(
          `/api/crypto-map/geocode?lat=${center.lat}&lon=${center.lon}`,
        );
        if (!geoRes.ok) return;
        const geo = (await geoRes.json()) as { result?: { countryCode?: string } };
        const country = geo.result?.countryCode;
        if (!country) return;
        if (country === lastCcRef.current) return; // already loaded this country
        lastCcRef.current = country;
        setCc(country);
        setLoading(true);
        const r = await fetch(`/api/fintech/available?cc=${country}`);
        if (r.ok) {
          const j = (await r.json()) as { rows?: Item[] };
          setItems(j.rows ?? []);
        }
      } catch {
        /* silent */
      } finally {
        setLoading(false);
      }
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [center?.lat, center?.lon]);

  if (!cc) return null;

  return (
    <div className="absolute right-3 top-3 z-10 w-64 max-w-[calc(100%-1.5rem)] rounded-xl border border-hairline bg-card/95 shadow-lg backdrop-blur">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-[12px] font-medium text-foreground"
      >
        <span className="truncate">{t("title", { country: cc })}</span>
        <span className="text-muted">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="max-h-80 overflow-y-auto px-1.5 pb-2">
          {loading ? (
            <p className="px-2 py-2 text-[11px] text-muted">{t("loading")}</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-muted">{t("empty", { country: cc })}</p>
          ) : (
            items.map((it) => (
              <Link
                key={it.id}
                href={`/${locale}/fintech/${it.slug}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-foreground hover:bg-bg-tint"
              >
                {it.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.logoUrl}
                    alt=""
                    className="h-6 w-6 rounded object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-6 w-6 rounded bg-bg-tint" />
                )}
                <span className="truncate text-[12px]">{it.displayName}</span>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
