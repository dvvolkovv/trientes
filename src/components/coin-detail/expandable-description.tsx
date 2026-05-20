"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export function ExpandableDescription({
  htmlShort,
  htmlFull,
}: {
  htmlShort: string;
  htmlFull: string;
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("detail");
  const html = open ? htmlFull : htmlShort;
  const showToggle = htmlShort !== htmlFull;
  return (
    <div>
      <div
        className="text-muted-strong leading-[1.7]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {showToggle && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-xs text-accent uppercase tracking-wider mt-3 hover:text-accent/80 transition-colors"
        >
          {open ? t("showLess") : t("readMore")}
        </button>
      )}
    </div>
  );
}
