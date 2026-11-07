"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Описание методики рядом с ценой. Цена без объяснения, откуда она, — ровно то,
 * что мы ставим в упрёк агрегаторам, поэтому метод раскрывается здесь же.
 */
export function IndexMethodology({ marketCount }: { marketCount: number }) {
  const t = useTranslations("coinCard.index");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] uppercase tracking-[0.12em] text-muted underline decoration-dotted hover:text-foreground"
      >
        {t("fromMarkets", { count: marketCount })}
      </button>
      {open && (
        <p className="text-xs text-muted mt-2 max-w-prose border-l border-hairline pl-3">
          {t("methodology")}
        </p>
      )}
    </>
  );
}
