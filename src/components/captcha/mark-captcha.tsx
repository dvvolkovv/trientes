"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CAPTCHA_STAGE, isSolved, type Geometry, type Point } from "@/lib/captcha";

export type CaptchaSolution = { token: string; x: number; y: number };

export type CaptchaLabels = {
  title: string;
  hint: string;
  idle: string;
  ok: string;
  bad: string;
  keyboard: string;
  reload: string;
};

type Challenge = Geometry & { token: string };

const MASK: React.CSSProperties = {
  WebkitMaskImage: "url(/captcha-mark.png)",
  maskImage: "url(/captcha-mark.png)",
  WebkitMaskSize: "contain",
  maskSize: "contain",
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
  maskPosition: "center",
};

/**
 * Капча «Соберите знак»: знак Trientes режется по своим же швам на три части,
 * одна вынута. Один растр (`/captcha-mark.png`) в маске CSS и три разреза
 * `clip-path` — цвет частей задаёт фон, а не три разных файла.
 *
 * Вошедшему капчи нет вовсе: маршрут выдачи отвечает `{ needed: false }`, и
 * тогда компонент ничего не рисует, а форме сразу отдаётся пустое решение.
 */
export function MarkCaptcha({
  onSolved,
  labels,
}: {
  onSolved: (s: CaptchaSolution | null) => void;
  labels: CaptchaLabels;
}) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [needed, setNeeded] = useState<boolean | null>(null);
  const [pos, setPos] = useState<Point>({ x: 0, y: 0 });
  const [solved, setSolved] = useState(false);
  const [bad, setBad] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ ox: number; oy: number } | null>(null);
  // Замыкание родителя меняется на каждый рендер, а эффект зовётся один раз:
  // без ref задача запрашивалась бы бесконечно.
  const onSolvedRef = useRef(onSolved);
  onSolvedRef.current = onSolved;

  const load = useCallback(async () => {
    setSolved(false);
    setBad(false);
    onSolvedRef.current(null);
    try {
      const res = await fetch("/api/captcha", { cache: "no-store" });
      const data = (await res.json()) as Partial<Challenge> & { needed?: boolean };
      if (data.needed === false) {
        setNeeded(false);
        onSolvedRef.current({ token: "", x: 0, y: 0 });
        return;
      }
      if (!data.token || !data.home || !data.start) {
        setNeeded(true);
        return;
      }
      setNeeded(true);
      setChallenge(data as Challenge);
      setPos(data.start);
    } catch {
      setNeeded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const settle = useCallback((c: Challenge, next: Point) => {
    if (!isSolved(c.home, next)) {
      setPos(next);
      return false;
    }
    setPos(c.home);
    setSolved(true);
    setBad(false);
    onSolvedRef.current({ token: c.token, x: c.home.x, y: c.home.y });
    return true;
  }, []);

  if (needed === false) return null;

  const scale = () => {
    const el = stageRef.current;
    return el && el.clientWidth ? el.clientWidth / CAPTCHA_STAGE.w : 1;
  };

  const partStyle = (clip: string, color: string, at: Point): React.CSSProperties => ({
    ...MASK,
    position: "absolute",
    width: `${((challenge?.mark.w ?? 1) / CAPTCHA_STAGE.w) * 100}%`,
    height: `${((challenge?.mark.h ?? 1) / CAPTCHA_STAGE.h) * 100}%`,
    left: `${(at.x / CAPTCHA_STAGE.w) * 100}%`,
    top: `${(at.y / CAPTCHA_STAGE.h) * 100}%`,
    clipPath: clip,
    background: color,
  });

  const pieceColor = "var(--color-accent)";
  const fixedColor = solved ? "var(--color-accent)" : "#ffffff";

  return (
    <div className="rounded-[18px] border border-hairline bg-card p-4">
      <h3 className="text-[14px] font-semibold">{labels.title}</h3>
      <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{labels.hint}</p>

      <div
        ref={stageRef}
        className={`relative mt-3 overflow-hidden rounded-[16px] border bg-bg-tint ${
          solved ? "border-accent/50" : "border-hairline"
        }`}
        style={{ aspectRatio: `${CAPTCHA_STAGE.w} / ${CAPTCHA_STAGE.h}`, touchAction: "none" }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (!drag || !challenge || solved) return;
          const k = scale();
          settle(challenge, { x: (e.clientX - drag.ox) / k, y: (e.clientY - drag.oy) / k });
        }}
        onPointerUp={() => {
          if (dragRef.current && challenge && !solved) setBad(true);
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        {challenge ? (
          <>
            {/* Рамка знака — видно, куда целиться. */}
            <div style={partStyle("none", "rgba(141,135,160,.34)", challenge.home)} />
            <div
              style={partStyle(
                `inset(0 0 ${((1 - challenge.cut.top) * 100).toFixed(2)}% 0)`,
                fixedColor,
                challenge.home,
              )}
            />
            <div
              style={partStyle(
                `inset(${((1 - challenge.cut.bottom) * 100).toFixed(2)}% 0 0 0)`,
                fixedColor,
                challenge.home,
              )}
            />
            <div
              role="button"
              tabIndex={0}
              aria-label={labels.title}
              className="cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent"
              style={{
                ...partStyle(
                  `inset(${(challenge.cut.top * 100).toFixed(2)}% 0 ${(challenge.cut.bottom * 100).toFixed(2)}% 0)`,
                  pieceColor,
                  pos,
                ),
                filter: solved ? undefined : "drop-shadow(0 10px 18px rgba(0,0,0,.55))",
              }}
              onPointerDown={(e) => {
                if (solved) return;
                const k = scale();
                dragRef.current = { ox: e.clientX - pos.x * k, oy: e.clientY - pos.y * k };
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              }}
              onKeyDown={(e) => {
                if (solved) return;
                const step = e.shiftKey ? 12 : 4;
                const map: Record<string, [number, number]> = {
                  ArrowLeft: [-step, 0],
                  ArrowRight: [step, 0],
                  ArrowUp: [0, -step],
                  ArrowDown: [0, step],
                };
                const d = map[e.key];
                if (d) {
                  e.preventDefault();
                  settle(challenge, { x: pos.x + d[0], y: pos.y + d[1] });
                } else if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (!settle(challenge, pos)) setBad(true);
                }
              }}
            />
          </>
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span
          className={`flex-1 text-[12px] ${
            solved ? "font-semibold text-up" : bad ? "font-semibold text-down" : "text-muted"
          }`}
        >
          {solved ? labels.ok : bad ? labels.bad : labels.idle}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          aria-label={labels.reload}
          title={labels.reload}
          className="h-9 min-w-9 rounded-full bg-card-alt px-3 text-[15px] text-muted-strong"
        >
          ↻
        </button>
      </div>
      <p className="mt-2 text-[10.5px] leading-snug text-muted">{labels.keyboard}</p>
    </div>
  );
}
