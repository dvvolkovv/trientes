"use client";

/**
 * Масштаб, компас и «моё положение» — кнопками под картой, а не поверх неё.
 *
 * Своё управление вместо `NavigationControl` понадобилось по простой причине:
 * на телефоне окно карты и так маленькое, а штатные кнопки стоят поверх него
 * и закрывают собой ту часть, ради которой карту и открыли. Под картой места
 * сколько угодно, и палец попадает в кнопку не глядя.
 *
 * У компаса два состояния. «Север вверх»: стрелка поворачивается вместе с
 * картой и показывает, где сейчас север, нажатие выпрямляет карту. «По
 * движению»: карта сама поворачивается туда, куда человек едет, — без этого
 * едущий на юг видел свою дорогу снизу вверх, то есть «назад». Решение, что
 * делает нажатие, принимает `compassTap`: повёрнутую пальцами карту первое
 * нажатие выпрямляет, и только второе включает слежение.
 */

import { compassLabelKeys, isStraight, type CompassMode } from "@/lib/compass-mode";

const BTN =
  "flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-xl border border-hairline " +
  "px-3 text-[13px] font-medium text-foreground transition-all hover:border-accent active:scale-95";

export function MapControls({
  bearing,
  pitch,
  compassMode,
  onZoomIn,
  onZoomOut,
  onCompass,
  onLocate,
  t,
}: {
  /** Текущий поворот карты в градусах — стрелка компаса смотрит на север. */
  bearing: number;
  pitch: number;
  /** Режим компаса: север вверх или карта по курсу движения. */
  compassMode: CompassMode;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCompass: () => void;
  /** «Моё положение» — та же кнопка, что у масштаба и компаса, а не в строке поиска. */
  onLocate: () => void;
  t: (key: string) => string;
}) {
  const following = compassMode === "heading";
  const north = isStraight({ bearing, pitch });
  const labels = compassLabelKeys({ mode: compassMode, straight: north });
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
        onClick={onCompass}
        aria-label={t(labels.aria)}
        title={t(labels.aria)}
        aria-pressed={following}
        className={
          BTN +
          (following
            ? " border-accent bg-accent/15 text-accent"
            : north
              ? ""
              : " border-accent/50 bg-accent/10")
        }
      >
        <span
          aria-hidden
          className="text-[15px] leading-none"
          // В режиме слежения стрелка смотрит вперёд по движению — она и так
          // всегда вверх экрана. В обычном режиме она показывает, где север:
          // карта повёрнута на `bearing`, значит север ушёл против поворота.
          style={following ? undefined : { transform: `rotate(${-bearing}deg)`, display: "inline-block" }}
        >
          {following ? "➤" : "↑"}
        </span>
        <span className="text-[12px]">{t(labels.short)}</span>
      </button>
      <button
        type="button"
        onClick={onLocate}
        aria-label={t("myLocation")}
        title={t("myLocation")}
        className={BTN}
      >
        <span aria-hidden className="text-[15px] leading-none">
          📍
        </span>
      </button>
    </div>
  );
}
