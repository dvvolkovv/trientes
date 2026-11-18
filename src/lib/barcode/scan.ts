/**
 * Кадр камеры → код товара. Чистая функция над пикселями: разбор не знает ни о видео, ни
 * о React, и поэтому проверяется тестом на нарисованных кадрах
 * (`tests/barcode-scan.test.ts`).
 *
 * Разбираем не весь кадр, а **несколько строк и столбцов**: линейный штрихкод одинаков
 * по всей своей высоте, и одна удачная строка решает дело. Столбцы нужны затем, что
 * телефон держат и поперёк — иначе человеку пришлось бы угадывать, как повернуть
 * аппарат. Обход идёт от середины наружу: код наводят на середину окна, и первая же
 * строка обычно и есть ответ.
 */

import { decodeEan } from "./ean";

export type Frame = { data: ArrayLike<number>; width: number; height: number };

/**
 * Ниже этого размаха яркости строка не разбирается вовсе. Тусклый кадр даёт случайные
 * полосы, а догадка здесь уезжает в паспорт товара — молчание честнее.
 */
const MIN_CONTRAST = 40;
const DEFAULT_LINES = 15;

/** Яркость по восприятию: зелёный весит больше синего, и для серого кадра это неважно. */
function luminance(data: ArrayLike<number>, at: number): number {
  return (data[at] * 299 + data[at + 1] * 587 + data[at + 2] * 114) / 1000;
}

/** Строка яркостей → ширины чередующихся полос или `null`, если строка пустая. */
export function lineToRuns(values: ArrayLike<number>): { runs: number[]; firstIsDark: boolean } | null {
  let min = 255;
  let max = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max - min < MIN_CONTRAST) return null;

  const threshold = (min + max) / 2;
  const runs: number[] = [];
  const firstIsDark = values[0] < threshold;
  let dark = firstIsDark;
  let width = 0;
  for (let i = 0; i < values.length; i += 1) {
    const isDark = values[i] < threshold;
    if (isDark === dark) {
      width += 1;
      continue;
    }
    runs.push(width);
    dark = isDark;
    width = 1;
  }
  runs.push(width);
  return { runs, firstIsDark };
}

/** Одна строка (или столбец) яркостей → код товара. */
export function scanLine(values: ArrayLike<number>): string | null {
  const line = lineToRuns(values);
  if (!line) return null;
  const forward = decodeEan(line.runs, line.firstIsDark);
  if (forward) return forward;

  // Символ, снятый справа налево, — тот же символ: читаем перевёрнутый массив полос.
  const reversed = [...line.runs].reverse();
  const lastIsDark = line.runs.length % 2 === 1 ? line.firstIsDark : !line.firstIsDark;
  return decodeEan(reversed, lastIsDark);
}

/** Доли 0..1 по числу линий, от середины наружу. */
function fractions(count: number): number[] {
  const all: number[] = [];
  for (let i = 0; i < count; i += 1) all.push((i + 0.5) / count);
  return all.sort((a, b) => Math.abs(a - 0.5) - Math.abs(b - 0.5));
}

export function scanFrame(frame: Frame, options: { lines?: number } = {}): string | null {
  const count = options.lines ?? DEFAULT_LINES;
  const { data, width, height } = frame;

  const row = new Float64Array(width);
  for (const f of fractions(count)) {
    const y = Math.min(height - 1, Math.floor(height * f));
    for (let x = 0; x < width; x += 1) row[x] = luminance(data, (y * width + x) * 4);
    const code = scanLine(row);
    if (code) return code;
  }

  const column = new Float64Array(height);
  for (const f of fractions(count)) {
    const x = Math.min(width - 1, Math.floor(width * f));
    for (let y = 0; y < height; y += 1) column[y] = luminance(data, (y * width + x) * 4);
    const code = scanLine(column);
    if (code) return code;
  }

  return null;
}
