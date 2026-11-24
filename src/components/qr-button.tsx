"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { QUIET_ZONE, qrDrawing } from "@/lib/qr-draw";

/**
 * Символ QR, нарисованный нами: тёмное на светлом при любой теме — читатели ждут
 * именно этого и половина другого не читает. Поэтому `#fff`/`#000` взяты прямо, а
 * не цветами темы.
 */
export function QrCodeSvg({ text, label, size = 220 }: { text: string; label: string; size?: number }) {
  const drawing = useMemo(() => qrDrawing(text), [text]);
  if (!drawing) return null;
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${drawing.side} ${drawing.side}`}
      shapeRendering="crispEdges"
      data-text={text}
    >
      <rect width={drawing.side} height={drawing.side} fill="#fff" />
      <path d={drawing.d} fill="#000" />
    </svg>
  );
}

/**
 * Кнопка «QR-код» у ссылки приглашения: человек стоит рядом, и показать ему экран
 * быстрее, чем переслать.
 *
 * Своего сканера в приложении нет и не нужно: QR читает **штатная камера** телефона
 * — наводишь, и открывается страница приглашения. Наш разбор кадра (слайс BB-2)
 * умеет штрихкоды товара, а не QR, и заводить второй читатель ради того, что
 * телефон делает сам, незачем.
 *
 * Символ не вместил ссылку — кнопки нет вовсе: пустая кнопка хуже её отсутствия
 * (правило BI). Такого не случается при наших длинах, но это и проверено.
 */
export function QrButton({
  text,
  className,
  panelClassName,
}: {
  text: string;
  className: string;
  panelClassName?: string;
}) {
  const t = useTranslations("common.qr");
  const [open, setOpen] = useState(false);
  const drawable = useMemo(() => qrDrawing(text) !== null, [text]);
  if (!drawable) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={className}
      >
        {t("show")}
      </button>
      {open ? (
        <div
          className={`w-full basis-full rounded-[14px] border border-hairline p-3 ${panelClassName ?? "bg-card"}`}
        >
          <div className="flex justify-center">
            <div className="rounded-[12px] bg-white p-2">
              <QrCodeSvg text={text} label={t("label")} />
            </div>
          </div>
          <p className="mt-2 text-center text-[12px] leading-snug text-muted">{t("hint")}</p>
          <p className="mt-1 break-all text-center text-[10.5px] leading-snug text-muted">{text}</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-2 min-h-11 w-full rounded-[12px] border border-hairline px-3 text-[12px] text-muted hover:border-accent"
          >
            {t("close")}
          </button>
        </div>
      ) : null}
    </>
  );
}

export { QUIET_ZONE };
