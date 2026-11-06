"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

type Hit = {
  kind: "coin" | "coinCard" | "exchange" | "fintech" | "company";
  id: string;
  title: string;
  subtitle: string | null;
  logoUrl: string | null;
  href: string;
};

export function GlobalSearch() {
  const t = useTranslations("common");
  const locale = useLocale();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced fetch as user types.
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const tm = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q.trim())}&locale=${encodeURIComponent(locale)}`,
          { signal: ctrl.signal },
        );
        const j = (await res.json()) as { hits: Hit[] };
        setHits(j.hits);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setHits([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => { ctrl.abort(); clearTimeout(tm); };
  }, [q, locale]);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div ref={wrapRef} className="relative w-full max-w-[280px] hidden md:block">
      <input
        type="search"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={t("searchPlaceholder")}
        className="w-full bg-bg-tint border border-hairline rounded-md px-3 py-1.5 text-[13px] placeholder:text-muted/60 focus:outline-none focus:border-accent"
      />
      {open && q.trim().length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-hairline rounded-md shadow-lg overflow-hidden z-50 max-h-[60vh] overflow-y-auto">
          {loading && hits.length === 0 ? (
            <div className="px-3 py-3 text-[12px] text-muted">{t("searching")}</div>
          ) : hits.length === 0 ? (
            <div className="px-3 py-3 text-[12px] text-muted">{t("noResults")}</div>
          ) : (
            <ul>
              {hits.map((h) => (
                <li key={`${h.kind}/${h.id}`}>
                  <Link
                    href={h.href}
                    onClick={() => { setOpen(false); setQ(""); }}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-bg-tint text-[13px] transition-colors"
                  >
                    {h.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={h.logoUrl} alt="" className="h-6 w-6 rounded object-cover flex-shrink-0" />
                    ) : (
                      <div className="h-6 w-6 rounded bg-bg-tint flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-foreground">{h.title}</div>
                      {h.subtitle ? (
                        <div className="truncate text-[11px] text-muted">{h.subtitle}</div>
                      ) : null}
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-muted/60 flex-shrink-0">
                      {t(`searchKind.${h.kind}`)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
