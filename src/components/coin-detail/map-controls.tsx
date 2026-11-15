"use client";

/**
 * Масштаб и компас — кнопками под картой, а не поверх неё.
 *
 * Своё управление вместо `NavigationControl` понадобилось по простой причине:
 * на телефоне окно карты и так маленькое, а штатные кнопки стоят поверх него
 * и закрывают собой ту часть, ради которой карту и открыли. Под картой места
 * сколько угодно, и палец попадает в кнопку не глядя.
 *
 * Стрелка компаса поворачивается вместе с картой, поэтому она показывает, где
 * сейчас север, а не просто «нажми сюда». Нажатие возвращает север вверх и
 * снимает наклон одним движением — заблудиться в повёрнутой карте легче
 * всего, и выход из этого должен быть один.
 */

const BTN =
  "flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-xl border border-hairline " +
  "px-3 text-[13px] font-medium text-foreground transition-all hover:border-accent active:scale-95";

export function MapControls({
  bearing,
  pitch,
  onZoomIn,
  onZoomOut,
  onResetNorth,
  t,
}: {
  /** Текущий поворот карты в градусах — стрелка компаса смотрит на север. */
  bearing: number;
  pitch: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetNorth: () => void;
  t: (key: string) => string;
}) {
  const north = Math.abs(bearing) < 0.5 && pitch < 0.5;
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onZoomOut} aria-label={t("zoomOut")} title={t("zoomOut")} className={BTN}>
        <span aria-hidden className="text-[18px] leading-none">
          −
        </span>
      </button>
      <button type="button" onClick={onZoomIn} aria-label={t("zoomIn2")} title={t("zoomIn2")} className={BTN}>
        <span aria-hidden className="text-[18px] leading-none">
          +
        </span>
      </button>
      <button
        type="button"
        onClick={onResetNorth}
        aria-label={t("resetNorth")}
        title={t("resetNorth")}
        aria-pressed={north}
        className={BTN + (north ? "" : " border-accent/50 bg-accent/10")}
      >
        <span
          aria-hidden
          className="text-[15px] leading-none"
          // Стрелка показывает, где север: карта повёрнута на `bearing`, значит
          // север ушёл против этого поворота.
          style={{ transform: `rotate(${-bearing}deg)`, display: "inline-block" }}
        >
          ↑
        </span>
        <span className="text-[12px]">{t("north")}</span>
      </button>
    </div>
  );
}
