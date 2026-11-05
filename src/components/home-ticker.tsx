"use client";

import Link from "next/link";
import { Sparkline } from "@/components/sparkline";

export type TickerItem =
  | { kind: "phrase"; text: string }
  | { kind: "stat"; label: string; value: string; href: string; ariaLabel?: string }
  // Same as a stat, plus a 7-day sparkline drawn right after the value.
  | {
      kind: "chart";
      label: string;
      value: string;
      points: number[] | null;
      href: string;
      ariaLabel?: string;
    };

type HomeTickerProps = {
  items: TickerItem[];
  ariaLabel: string;
};

export function HomeTicker({ items, ariaLabel }: HomeTickerProps) {
  if (items.length === 0) return null;

  // Duplicate the items so translateX(-50%) yields a seamless loop.
  const doubled = [...items, ...items];

  return (
    <section
      aria-label={ariaLabel}
      className="border-y border-hairline bg-bg"
    >
      <div className="ticker-viewport">
        <div className="ticker-track">
          {doubled.map((item, i) => (
            <span key={i} className="inline-flex items-center">
              {item.kind === "phrase" ? (
                <span className="ticker-dot-white">{item.text}</span>
              ) : (
                <Link
                  href={item.href}
                  className="ticker-dot-orange hover:opacity-80 transition-opacity"
                  aria-label={item.ariaLabel ?? `${item.label} ${item.value}`}
                >
                  <em className="ticker-stat-label">{item.label}</em>
                  {item.value}
                  {item.kind === "chart" ? (
                    <span className="ticker-chart" aria-hidden>
                      <Sparkline
                        points={item.points}
                        width={132}
                        height={40}
                        strokeWidth={2}
                        stroke="#fe5c04"
                        gradientId={`ticker-spark-${i}`}
                      />
                    </span>
                  ) : null}
                </Link>
              )}
              <span className="ticker-sep" aria-hidden>
                •
              </span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
