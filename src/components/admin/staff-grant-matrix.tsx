"use client";

import type { PresetKey } from "@/lib/staff/presets";

export type Level = "VIEW" | "HANDLE" | "APPROVE";
/** Очередь → уровень; `null` значит «нет доступа»: запрет по умолчанию. */
export type MatrixValue = Record<string, Level | null>;

export type MatrixLabels = {
  queues: Record<string, string>;
  levels: Record<string, string>;
  noneLevel: string;
  presetsLabel: string;
  presets: Record<PresetKey, string>;
  presetsHint: string;
};

const LEVELS: (Level | null)[] = [null, "VIEW", "HANDLE", "APPROVE"];

/**
 * Матрица «очередь × уровень». Радиокнопки, а не галочки: уровни не
 * складываются — `APPROVE` уже включает `HANDLE`, и две отметки в одной строке
 * означали бы противоречие.
 */
export function GrantMatrix({
  value,
  onChange,
  labels,
  presets,
}: {
  value: MatrixValue;
  onChange: (next: MatrixValue) => void;
  labels: MatrixLabels;
  /** Готовые должности заполняют матрицу целиком; после них галочки правятся руками. */
  presets?: { key: PresetKey; levels: MatrixValue }[];
}) {
  const queues = Object.keys(labels.queues);

  return (
    <div className="mb-3">
      {presets && presets.length > 0 ? (
        <div className="mb-3">
          <div className="mb-1.5 text-[9.5px] uppercase tracking-[0.15em] text-muted">
            {labels.presetsLabel}
          </div>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onChange(p.levels)}
                className="rounded-full border border-hairline bg-card px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted hover:bg-card-alt"
              >
                {labels.presets[p.key]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-muted">{labels.presetsHint}</p>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <th className="pb-2 text-left font-semibold" />
              {LEVELS.map((level) => (
                <th
                  key={level ?? "none"}
                  className="px-1 pb-2 text-center text-[9.5px] uppercase tracking-[0.12em] text-muted"
                >
                  {level === null ? labels.noneLevel : labels.levels[level]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {queues.map((queue) => (
              <tr key={queue} className="border-t border-hairline">
                <td className="py-1.5 pr-2">{labels.queues[queue]}</td>
                {LEVELS.map((level) => (
                  <td key={level ?? "none"} className="px-1 py-1.5 text-center">
                    <input
                      type="radio"
                      name={`grant-${queue}`}
                      checked={(value[queue] ?? null) === level}
                      onChange={() => onChange({ ...value, [queue]: level })}
                      className="h-6 w-6 accent-[var(--accent)]"
                      aria-label={`${labels.queues[queue]}: ${
                        level === null ? labels.noneLevel : labels.levels[level]
                      }`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
