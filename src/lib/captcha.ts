/**
 * Капча «Соберите знак»: чистая геометрия, без Redis и без подписи.
 *
 * Поле — условные единицы (320×190), клиент масштабирует их под свою ширину.
 * Единицы, а не пиксели: на телефоне и на компьютере задача должна быть одна и
 * та же, иначе допуск в пикселях означал бы разную строгость.
 */

export const CAPTCHA_STAGE = { w: 320, h: 190 } as const;
/** Размер знака на поле. Отношение сторон — у `public/captcha-mark.png` (1,395). */
export const CAPTCHA_MARK = { w: 132, h: 94.6 } as const;
/** Допуск попадания. */
export const CAPTCHA_TOLERANCE = 13;
/** Быстрее этого человек не успевает прочитать задачу и дотянуть часть. */
export const MIN_SOLVE_MS = 800;
/** Задача живёт пять минут. */
export const MAX_AGE_MS = 5 * 60 * 1000;

/** Насколько вынутая часть отодвинута от места. Больше трёх допусков. */
const START_GAP = 45;

export type Point = { x: number; y: number };

export type Geometry = {
  stage: { w: number; h: number };
  mark: { w: number; h: number };
  /** Куда должна встать вынутая часть. */
  home: Point;
  /** Где она лежит в начале. */
  start: Point;
  /** Где проходит разрез — доли высоты знака сверху и снизу. */
  cut: { top: number; bottom: number };
};

/** Разрез по швам знака: рога с крышей, средняя галочка, нижняя дуга. */
const CUT = { top: 0.45, bottom: 0.28 } as const;

export function newGeometry(random: () => number = Math.random): Geometry {
  const maxX = CAPTCHA_STAGE.w - CAPTCHA_MARK.w;
  const maxY = CAPTCHA_STAGE.h - CAPTCHA_MARK.h;
  // Точка сборки гуляет по полю: записанный ответ не переиспользовать. Полоса
  // середины, а не весь прямоугольник, — чтобы вынутой части всегда хватало
  // места отодвинуться в сторону, не упираясь в край.
  const home = {
    x: Math.round(maxX * (0.25 + random() * 0.5)),
    y: Math.round(maxY * (0.2 + random() * 0.6)),
  };
  // В какую сторону отодвинуть — решает та сторона, где больше места: так
  // расстояние гарантировано, а не «обычно получается».
  const left = home.x > maxX / 2;
  const span = left ? home.x - START_GAP : maxX - (home.x + START_GAP);
  const start = {
    x: Math.round(left ? random() * span : home.x + START_GAP + random() * span),
    y: Math.round(random() * maxY),
  };
  return { stage: { ...CAPTCHA_STAGE }, mark: { ...CAPTCHA_MARK }, home, start, cut: { ...CUT } };
}

export function isSolved(home: Point, at: Point): boolean {
  return (
    Math.abs(home.x - at.x) <= CAPTCHA_TOLERANCE && Math.abs(home.y - at.y) <= CAPTCHA_TOLERANCE
  );
}

/** Возвращает код отказа или null. */
export function checkTiming(issuedAtMs: number, nowMs: number): string | null {
  const age = nowMs - issuedAtMs;
  // Отрицательный возраст — часы разошлись или токен выдуман: это просрочка,
  // а не «ещё не наступило».
  if (age < 0 || age > MAX_AGE_MS) return "captcha_expired";
  if (age < MIN_SOLVE_MS) return "captcha_too_fast";
  return null;
}
