"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

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
        className="prose prose-sm dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {showToggle && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setOpen(!open)}>
          {open ? t("showLess") : t("readMore")}
        </Button>
      )}
    </div>
  );
}
