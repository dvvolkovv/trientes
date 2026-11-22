"use client";

import { useState, useTransition } from "react";
import { SECTION_COLORS, SECTION_COLOR_KEYS, type SectionColorKey } from "@/lib/admin-sections";
import { setSectionColor } from "@/app/actions/admin-appearance";
import { ADMIN_TAB, adminChoiceLook } from "@/lib/admin-ui";

/**
 * Образец кнопки и палитра для одного раздела. Образец меняется сразу — иначе
 * человек выбирает цвет вслепую и ждёт перезагрузки, чтобы увидеть выбор.
 */
export function SectionColorPicker({
  section,
  label,
  initial,
  noneLabel,
  colorNames,
}: {
  section: string;
  label: string;
  initial: SectionColorKey | null;
  noneLabel: string;
  colorNames: Record<string, string>;
}) {
  const [color, setColor] = useState<SectionColorKey | null>(initial);
  const [pending, startTransition] = useTransition();
  const hex = color ? SECTION_COLORS[color] : null;
  const look = adminChoiceLook(hex, true);

  function pick(next: SectionColorKey | null) {
    setColor(next);
    startTransition(async () => {
      await setSectionColor({ section, color: next });
    });
  }

  return (
    <div className="rounded-[18px] border border-hairline bg-card p-4">
      <div
        // Образец показан нажатым: цвет надо выбирать по тому виду, в котором
        // кнопка ярче всего, а не по приглушённому.
        style={look.style}
        className={`${ADMIN_TAB} ${look.className} ${pending ? "opacity-60" : ""} w-fit max-w-full`}
      >
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => pick(null)}
          aria-pressed={color === null}
          title={noneLabel}
          className={`h-9 w-9 rounded-full border-2 text-[11px] text-muted transition-colors ${
            color === null ? "border-foreground" : "border-hairline hover:border-muted"
          }`}
        >
          ✕
        </button>
        {SECTION_COLOR_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => pick(key)}
            aria-pressed={color === key}
            title={colorNames[key] ?? key}
            style={{ backgroundColor: SECTION_COLORS[key] }}
            className={`h-9 w-9 rounded-full border-2 transition-colors ${
              color === key ? "border-foreground" : "border-transparent hover:border-muted"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
