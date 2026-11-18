/**
 * Кодировщик линейного штрихкода — только для тестов: сайт штрихкоды читает, а не
 * печатает. Он же служит определением формата, по которому проверяется читатель
 * (`src/lib/barcode/ean.ts`).
 */
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = L.map((bits) => [...bits].map((b) => (b === "1" ? "0" : "1")).join(""));
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export function encodeEan13(code: string): string {
  const d = [...code].map(Number);
  const parity = PARITY[d[0]];
  let bits = "101";
  for (let i = 0; i < 6; i += 1) bits += parity[i] === "L" ? L[d[i + 1]] : G[d[i + 1]];
  bits += "01010";
  for (let i = 7; i < 13; i += 1) bits += R[d[i]];
  return `${bits}101`;
}

export function encodeEan8(code: string): string {
  const d = [...code].map(Number);
  let bits = "101";
  for (let i = 0; i < 4; i += 1) bits += L[d[i]];
  bits += "01010";
  for (let i = 4; i < 8; i += 1) bits += R[d[i]];
  return `${bits}101`;
}

/** Модули → ширины полос, с заданной шириной модуля и шумом замера. */
export function bitsToRuns(bits: string, moduleWidth = 1, jitter = 0): { runs: number[]; firstIsDark: boolean } {
  const runs: number[] = [];
  let seed = 7;
  const noise = () => {
    if (jitter === 0) return 0;
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return ((seed / 2147483648) * 2 - 1) * jitter;
  };
  let i = 0;
  while (i < bits.length) {
    let n = 1;
    while (i + n < bits.length && bits[i + n] === bits[i]) n += 1;
    runs.push(n * moduleWidth + noise());
    i += n;
  }
  return { runs, firstIsDark: bits[0] === "1" };
}

export type DrawOptions = {
  width?: number;
  height?: number;
  moduleWidth?: number;
  /** Левый край символа в долях ширины кадра. */
  left?: number;
  /** Полоса кадра по вертикали, занятая символом (доли высоты). */
  top?: number;
  bottom?: number;
  /** Символ в зеркале — телефон держат «наоборот». */
  mirrored?: boolean;
  /** Полосы лежат, а не стоят — телефон повёрнут на 90°. */
  vertical?: boolean;
  /** Шум камеры, ±значение яркости. */
  noise?: number;
  dark?: number;
  light?: number;
};

/** Модули → кадр RGBA, как его отдаёт `canvas.getImageData`. */
export function drawSymbol(bits: string, options: DrawOptions = {}) {
  const {
    width = 480,
    height = 360,
    moduleWidth = 3,
    left = 0.1,
    top = 0.3,
    bottom = 0.7,
    mirrored = false,
    vertical = false,
    noise = 0,
    dark = 30,
    light = 230,
  } = options;

  const modules = mirrored ? [...bits].reverse().join("") : bits;
  const w = vertical ? height : width;
  const h = vertical ? width : height;
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 11;
  const jitter = () => {
    if (noise === 0) return 0;
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return ((seed / 2147483648) * 2 - 1) * noise;
  };

  const x0 = Math.round(w * left);
  const y0 = Math.round(h * top);
  const y1 = Math.round(h * bottom);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const inBand = y >= y0 && y < y1;
      const module = Math.floor((x - x0) / moduleWidth);
      const bar = inBand && module >= 0 && module < modules.length && modules[module] === "1";
      const value = (bar ? dark : light) + jitter();
      // Повёрнутый кадр пишется транспонированно: читатель кадра не знает, как держат телефон.
      const px = vertical ? y : x;
      const py = vertical ? x : y;
      const at = (py * width + px) * 4;
      data[at] = value;
      data[at + 1] = value;
      data[at + 2] = value;
      data[at + 3] = 255;
    }
  }
  return { data, width, height };
}
