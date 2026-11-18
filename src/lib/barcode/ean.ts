/**
 * Читатель линейного штрихкода — EAN-13, EAN-8 и UPC-A (спека
 * `docs/superpowers/specs/2026-11-18-barcode-scan-and-dictation-design.md`).
 *
 * Своё, а не библиотека: браузерный `BarcodeDetector` есть у Chrome и нет у Safari, то
 * есть у половины телефонов владельца магазина его нет вовсе, а тащить wasm-сборку
 * ZXing в страницу кабинета ради тринадцати цифр дорого. Код держится на том же приёме,
 * что весь проект: чистая функция поверх чисел, накрытая тестом, у которого свой
 * кодировщик.
 *
 * На вход идут **ширины полос** (чередующиеся тёмная/светлая), а не пиксели: разбор
 * кадра — дело слоя выше (`scan.ts`), и читателю всё равно, снят кадр камерой или
 * собран тестом.
 */

import { parseGtin } from "@/lib/products/gtin";

/**
 * Ширины четырёх полос одной цифры. Левая половина символа кодируется этими же числами
 * (набор L), её «чётная» половина (набор G) — ими же задом наперёд, правая половина
 * (набор R) — ими же с переменой цвета. Поэтому таблица одна, а не три.
 */
const PATTERNS: readonly (readonly number[])[] = [
  [3, 2, 1, 1],
  [2, 2, 2, 1],
  [2, 1, 2, 2],
  [1, 4, 1, 1],
  [1, 1, 3, 2],
  [1, 2, 3, 1],
  [1, 1, 1, 4],
  [1, 3, 1, 2],
  [1, 2, 1, 3],
  [3, 1, 1, 2],
];

/**
 * Первая цифра EAN-13 нигде не нарисована: её говорит чередование наборов L и G в левой
 * половине. Бит 5 — первая из шести цифр.
 */
const FIRST_DIGIT_PARITY = [0x00, 0x0b, 0x0d, 0x0e, 0x13, 0x19, 0x1c, 0x15, 0x16, 0x1a];

const MAX_INDIVIDUAL_VARIANCE = 0.7;
const MAX_AVG_VARIANCE = 0.48;

/** Отклонение замеренных полос от образца, в долях модуля. `null` — не этот образец. */
function variance(runs: number[], at: number, pattern: readonly number[], reversed: boolean): number | null {
  let total = 0;
  for (let i = 0; i < pattern.length; i += 1) total += runs[at + i];
  if (total <= 0) return null;

  const patternTotal = pattern.reduce((a, b) => a + b, 0);
  const unit = total / patternTotal;
  const maxIndividual = unit * MAX_INDIVIDUAL_VARIANCE;

  let sum = 0;
  for (let i = 0; i < pattern.length; i += 1) {
    const expected = pattern[reversed ? pattern.length - 1 - i : i] * unit;
    const diff = Math.abs(runs[at + i] - expected);
    if (diff > maxIndividual) return null;
    sum += diff;
  }
  return sum / total;
}

/** Одна цифра. `even` — набор G (встречается только в левой половине EAN-13). */
function digitAt(runs: number[], at: number, allowEven: boolean): { digit: number; even: boolean } | null {
  let best: { digit: number; even: boolean } | null = null;
  let bestVariance = MAX_AVG_VARIANCE;

  for (let digit = 0; digit < PATTERNS.length; digit += 1) {
    const odd = variance(runs, at, PATTERNS[digit], false);
    if (odd !== null && odd < bestVariance) {
      bestVariance = odd;
      best = { digit, even: false };
    }
    if (!allowEven) continue;
    const even = variance(runs, at, PATTERNS[digit], true);
    if (even !== null && even < bestVariance) {
      bestVariance = even;
      best = { digit, even: true };
    }
  }
  return best;
}

/** Ограничительная полоса: подряд идущие полосы шириной в один модуль. */
function guardOk(runs: number[], at: number, count: number, module: number): boolean {
  for (let i = 0; i < count; i += 1) {
    if (Math.abs(runs[at + i] - module) > module * 0.5) return false;
  }
  return true;
}

function attempt(runs: number[], start: number, digits: 13 | 8): string | null {
  const half = digits === 13 ? 6 : 4;
  const need = 3 + half * 4 + 5 + half * 4 + 3;
  const totalModules = digits === 13 ? 95 : 67;
  if (start + need > runs.length) return null;

  // Грубая оценка модуля — по стартовой полосе; точная — по всей ширине символа. Первая
  // отсеивает заведомо не тот край, вторая устойчива к шуму замера.
  const coarse = (runs[start] + runs[start + 1] + runs[start + 2]) / 3;
  if (!(coarse > 0) || !guardOk(runs, start, 3, coarse)) return null;

  let total = 0;
  for (let i = 0; i < need; i += 1) total += runs[start + i];
  const module = total / totalModules;
  if (Math.abs(coarse - module) > module * 0.5) return null;

  const middle = start + 3 + half * 4;
  const end = middle + 5 + half * 4;
  if (!guardOk(runs, start, 3, module)) return null;
  if (!guardOk(runs, middle, 5, module)) return null;
  if (!guardOk(runs, end, 3, module)) return null;

  let parity = 0;
  let value = "";
  for (let i = 0; i < half; i += 1) {
    const d = digitAt(runs, start + 3 + i * 4, digits === 13);
    if (!d) return null;
    if (d.even) parity |= 1 << (half - 1 - i);
    value += d.digit;
  }
  // EAN-8 набора G не знает: «чётная» цифра в его левой половине значит, что это не он.
  if (digits === 8 && parity !== 0) return null;

  for (let i = 0; i < half; i += 1) {
    const d = digitAt(runs, middle + 5 + i * 4, false);
    if (!d) return null;
    value += d.digit;
  }

  if (digits === 13) {
    const first = FIRST_DIGIT_PARITY.indexOf(parity);
    if (first < 0) return null;
    value = `${first}${value}`;
  }

  // Контрольная цифра — последний охранник: без него шум иногда складывается в
  // правдоподобные тринадцать цифр, и в паспорт уехал бы чужой товар.
  return parseGtin(value);
}

/**
 * Ширины полос → код товара или `null`.
 *
 * `firstIsDark` говорит цвет первой полосы: цвета дальше чередуются, и держать их
 * отдельным массивом незачем. Символ, снятый справа налево, читается тем же вызовом с
 * перевёрнутым массивом — это делает слой кадра.
 */
export function decodeEan(runs: number[], firstIsDark: boolean): string | null {
  // Двумя проходами, а не одним: EAN-8 короче, и в мусоре перед настоящим символом он
  // иногда «находится» раньше — тогда в поле уехал бы восьмизначный призрак.
  for (const digits of [13, 8] as const) {
    for (let i = 0; i < runs.length; i += 1) {
      const dark = firstIsDark ? i % 2 === 0 : i % 2 === 1;
      if (!dark) continue;
      const code = attempt(runs, i, digits);
      if (code) return code;
    }
  }
  return null;
}
