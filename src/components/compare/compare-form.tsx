"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type Hit = { kind: string; id: string; title: string; subtitle: string | null; logoUrl: string | null; href: string };

export function CompareForm({ locale, initial }: { locale: string; initial: string[] }) {
  const t = useTranslations("compare");
  const router = useRouter();
  const padded = [...initial, "", "", ""].slice(0, 4);
  const [slots, setSlots] = useState<string[]>(padded);

  function setSlot(i: number, v: string) {
    setSlots((arr) => arr.map((x, idx) => (idx === i ? v : x)));
  }

  function submit() {
    const clean = slots.map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (clean.length === 0) return;
    const u = new URLSearchParams({ coins: clean.join(",") });
    router.push(`/${locale}/compare?${u.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      {slots.map((v, i) => (
        <SlotInput
          key={i}
          value={v}
          onChange={(next) => setSlot(i, next)}
          placeholder={t(i < 2 ? "slotRequired" : "slotOptional")}
        />
      ))}
      <button type="button" onClick={submit}
        className="text-[13px] px-4 py-2 rounded-md font-medium bg-accent text-accent-foreground">
        {t("submit")}
      </button>
    </div>
  );
}

function SlotInput({ value, onChange, placeholder }: { value: string; onChange: (s: string) => void; placeholder: string }) {
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (value.trim().length < 2) { setHits([]); return; }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const tm = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(value.trim())}`, { signal: ctrl.signal });
        const j = (await res.json()) as { hits: Hit[] };
        setHits(j.hits.filter((h) => h.kind === "coin").slice(0, 6));
      } catch { /* aborted */ }
    }, 200);
    return () => { ctrl.abort(); clearTimeout(tm); };
  }, [value]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-44 bg-card border border-hairline rounded-md px-3 py-2 text-[13px]"
      />
      {open && hits.length > 0 && (
        <ul className="absolute top-full left-0 right-0 mt-1 bg-card border border-hairline rounded-md shadow-lg z-50 max-h-60 overflow-y-auto">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button"
                onClick={() => { onChange(h.id); setOpen(false); }}
                className="w-full text-left flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-bg-tint">
                {h.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={h.logoUrl} alt="" className="h-5 w-5 rounded-full" />
                ) : (
                  <div className="h-5 w-5 rounded-full bg-bg-tint" />
                )}
                <span>{h.title}</span>
                {h.subtitle ? <span className="text-[11px] text-muted">{h.subtitle}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
