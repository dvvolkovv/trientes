# Крипто-навигатор: live-режим ведения по маршруту (Slice 1 — walk)

**Дата:** 2026-05-24
**Раздел:** новая кнопка «Старт» + live-ведение по маршруту в `CryptoNavigator`

## Контекст

Сейчас навигатор умеет строить маршрут (`/api/crypto-map/directions` → LineString
+ distance/duration) и рисовать его на карте. Но «вести» пользователя по маршруту
в реальном времени он не умеет — нет кнопки Старт, нет постоянной геолокации,
нет автоповорота камеры и нет индикации «остаток пути сейчас N м». Поверка
устной (см. голосовое `otchet-navigator-start-vopros-2026-05-24.mp3`).

Запрошено голосом 2026-05-24. Решения по неясным точкам согласованы голосом
(«сделай как лучше, доверяю»):

- **Режимы:** в этом слайсе ведём **только пешком** (`mode === "walk"`).
  Машина и транспорт — отдельные слайсы; машина без голосовых подсказок
  небезопасна, транспорт компенсируется расписанием.
- **Off-route:** показываем кнопку «Пересчитать» (а не пересчитываем
  автоматически). Авто-пересчёт жрёт квоту OSRM/MOTIS и сбивает пользователя
  с толку, если он остановился по делу.
- **Голосовых подсказок и поворотных инструкций нет.** Чтобы их сделать,
  нужно перестроить `/api/crypto-map/directions` под OSRM-формат со `steps[]`
  (manoeuvre, name, direction). Это отдельный слайс.

## Принципы

- Никаких изменений в API: маршрут уже отдаёт LineString — всю «навигацию»
  делаем на клиенте через геометрию полилинии.
- Никакой работы в `trientes-worker`: модуль чисто фронтовый.
- Wake Lock на время ведения, корректное освобождение при выходе.
- Контроллер — отдельный, тестируемый модуль; UI-компонент не лезет в детали
  watchPosition / wakeLock / геометрии.

## Размещение и UX

### Кнопка «Старт» (две точки входа)

1. В попапе POI (`buildCard()` в `crypto-navigator.tsx` ~ строки 734+) — рядом
   с существующими `.cmap-route` и `.cmap-street` появляется третья кнопка
   `.cmap-start`. Появляется ТОЛЬКО если `mode === "walk"`; на car/transit она
   просто не рендерится. Клик: ставит POI как destination → строит маршрут →
   запускает ведение (как если бы пользователь нажал Route, потом Старт).
2. В сводке маршрута (Route summary bar, строки 629–667 `crypto-navigator.tsx`)
   — кнопка «▶ Старт» появляется после того, как маршрут построен и `mode ===
   "walk"`. Стоит рядом с «Очистить маршрут».

### Что появляется во время ведения

Сводка маршрута переключается в «живой» вид:

- **Слева:** `остаток N.N км · M мин` — пересчитывается на каждом тике
  геолокации. Считается от ближайшей точки маршрута до конца, не от текущей
  позиции пользователя по прямой.
- **Справа:**
  - Кнопка **«Стоп»** — всегда видна. Останавливает watch, отпускает wake lock,
    карта возвращается к pitch=0, bearing=0.
  - Кнопка **«Пересчитать»** — появляется только когда пользователь >30 м от
    полилинии. По клику дёргает существующий `buildRoute()` с
    `originRef.current = current GPS`, маршрут перерисовывается, ведение
    продолжается на новом маршруте.

При прибытии (≤25 м до destination) — статус-баннер «Вы прибыли», авто-стоп
через 5 секунд.

### Камера

Каждый тик геолокации (макс. 1 Гц, throttled):

- `map.easeTo({ center, bearing, pitch: 45, duration: 800 })`
- `bearing` — `coords.heading`, если есть и `coords.speed > 0.5 m/s`; иначе
  держим прошлый bearing (heading нестабилен при низкой скорости/в стоянке).
- При старте: `map.easeTo({ zoom: 17 })` один раз. Дальше зум не трогаем —
  пользователь может крутить колесом/жестом сам, мы лишь центрируем камеру
  и поворачиваем bearing на каждый тик.

## Компоненты

### `src/lib/route-geometry.ts` (новый, ~80 строк)

Чистые функции, ноль зависимостей:

```ts
export function haversineMeters(a: [number, number], b: [number, number]): number;

// Returns {point, t, segmentIndex, distance} — nearest point on polyline, t∈[0,1]
// within the segment, segmentIndex into coords array, distance in meters.
export function nearestOnLineString(
  p: [number, number],
  coords: [number, number][],
): { point: [number, number]; segmentIndex: number; t: number; distance: number };

// Remaining length from the projected position to the end of the polyline.
export function remainingMeters(
  coords: [number, number][],
  segmentIndex: number,
  t: number,
): number;
```

Унит-тесты под `src/lib/__tests__/route-geometry.test.ts` (vitest уже в проекте):
прямая линия, ноль-длина-сегмент, точка точно на вершине, точка далеко в
стороне. Без unit-тестов компонент будет тяжело отлаживать.

### `src/lib/wake-lock.ts` (новый, ~40 строк)

Тонкая обёртка над `navigator.wakeLock`:

```ts
export type WakeLockHandle = { release: () => void };

export async function acquireWakeLock(): Promise<WakeLockHandle | null>;
//   - возвращает null, если API недоступен (Safari ≤16.4, Firefox < 126)
//   - повторно запрашивает на `document.visibilitychange === "visible"`
//     (типовой Safari-quirk: lock освобождается при background)
```

### `src/components/coin-detail/navigation-controller.ts` (новый, ~120 строк)

Императивный класс, инициализируется из `crypto-navigator.tsx`:

```ts
export type NavigationCallbacks = {
  onPosition: (pos: GeolocationPosition) => void;     // тик GPS
  onProgress: (remainingMeters: number, etaSeconds: number) => void;
  onOffRoute: (distanceFromRouteMeters: number) => void;
  onArrival: () => void;
  onError: (message: string) => void;                 // permission denied, и т.п.
};

export class NavigationController {
  constructor(routeCoords: [number, number][], walkSpeedMps: number);
  async start(cb: NavigationCallbacks): Promise<void>;
  stop(): void;
  updateRoute(newCoords: [number, number][]): void;   // вызывается после recompute
}
```

Внутри:

- `navigator.geolocation.watchPosition()` с `enableHighAccuracy: true`,
  `maximumAge: 1000`, `timeout: 10000`.
- На каждый тик: `nearestOnLineString` → если distance > 30 м, `onOffRoute`;
  если ≤30 м, `onProgress(remaining, remaining/walkSpeedMps)`; если remaining
  ≤25 м → `onArrival`.
- Throttle: камера/`onProgress` максимум раз в секунду, чтобы не дёргать
  React-перерисовки.
- `walkSpeedMps` — берём 1.35 (среднее пешком) как стартовое значение для
  ETA, если `coords.speed` недоступен; иначе сглаживаем (`EMA α=0.3`).
- `stop()` — `clearWatch` + `wakeLock.release()`.

### Изменения в `src/components/coin-detail/crypto-navigator.tsx`

Точки касания:

- Стейт: `const [navActive, setNavActive] = useState(false)`,
  `const [navOffRoute, setNavOffRoute] = useState<number | null>(null)`,
  `const [navRemaining, setNavRemaining] = useState<{m: number; sec: number} | null>(null)`,
  `const navControllerRef = useRef<NavigationController | null>(null)`.
- Хелперы `startNavigation()` / `stopNavigation()` создают/убивают контроллер,
  захватывают/отпускают wake lock, переключают камеру pitch.
- Кнопка `.cmap-start` в `buildCard()` (только для walk) — клик: setDestination
  → ждём `route` → `startNavigation()`. UX: показываем краткий «Запрашиваю
  GPS…» через существующий `status` state.
- Кнопка ▶ Старт в Route summary bar, видна когда `route && route.mode ===
  "walk" && !navActive`.
- Кнопка Стоп — видна когда `navActive`.
- Кнопка «Пересчитать» — видна когда `navActive && navOffRoute && navOffRoute >
  30`. По клику: `buildRoute()` (он уже подхватит `originRef.current`).
- Подмена сводки: когда `navActive`, вместо `duration` + `distance` показываем
  live-значения из `navRemaining`.

## Доступность и ошибки

- Геолокация отказана → статус-баннер «Доступ к геолокации запрещён. Включи в
  настройках браузера, чтобы вести по маршруту.» Кнопка переключается обратно
  в Start.
- Wake Lock недоступен → ведение работает, просто не блокируем экран
  (молчаливо).
- Браузер ушёл в background → wake lock освободится, при возврате —
  re-acquire (см. `src/lib/wake-lock.ts`).
- Кнопки имеют `aria-label`, иконки `aria-hidden`.

## i18n

Новые ключи в `cryptoMap.*` во всех 10 локалях:

```jsonc
"cryptoMap": {
  // ... существующие ключи без изменений
  "start": "Старт",
  "stop": "Стоп",
  "recompute": "Пересчитать",
  "remaining": "Осталось",
  "etaMin": "{min} мин",
  "arrived": "Вы прибыли",
  "permissionDenied": "Доступ к геолокации запрещён. Включи его в настройках, чтобы вести по маршруту.",
  "startOnlyWalk": "Доступно только для пешеходного маршрута",
  "navStarting": "Запрашиваю GPS…"
}
```

Английские (для en.json): `Start`, `Stop`, `Recompute`, `Remaining`, `{min} min`,
`You have arrived`, `Geolocation is blocked. Enable it in your browser settings
to navigate.`, `Available only for walking routes`, `Requesting GPS…`. Остальные
8 локалей — параллельные переводы.

## Тестирование

### Unit (vitest, уже в проекте)

`src/lib/__tests__/route-geometry.test.ts`:

- `haversineMeters`: известные пары координат (Москва—Питер ≈ 635 км ± 1 км),
  одна и та же точка → 0.
- `nearestOnLineString`: точка точно на вершине → distance=0, t=0/1
  как ожидается; точка на середине сегмента → distance=0, t≈0.5; точка в
  стороне → distance корректна; вырожденный сегмент (a==b) не делит на 0.
- `remainingMeters`: сумма от середины первого сегмента ≈ половина длины
  сегмента + длина остальных; от последней точки → 0.

### Ручное (на проде, после деплоя)

1. Открыть `/{locale}/coin/bitcoin` или любую coin-страницу с навигатором.
2. Дать разрешение на геолокацию, выбрать `walk`, кликнуть по любой POI, в
   попапе нажать Старт.
3. Убедиться: статус «Запрашиваю GPS», затем карта подъезжает, pitch=45,
   живые цифры обновляются.
4. Походить (или подменить координаты в DevTools → Sensors). Цифра «Осталось»
   уменьшается.
5. Сдвинуть симулированную позицию >30 м от линии — появилась кнопка
   «Пересчитать»; клик — маршрут перестраивается, ведение продолжается.
6. Подойти к destination (≤25 м) — появилось «Вы прибыли», через 5 секунд
   ведение само остановилось.
7. Нажать Стоп вручную в середине маршрута — карта возвращается к pitch=0,
   GPS не дёргается дальше (проверить отсутствие watchPosition в
   `performance.getEntries()` или просто DevTools → Sensors не светится).

## Что НЕ делаем в этом слайсе

- **Голосовые подсказки / turn-by-turn.** Требуют step-by-step данных от
  routing-движка — это перестройка `/api/crypto-map/directions`. Отдельный
  слайс.
- **Car / transit live-ведение.** Car без голоса небезопасен; transit лучше
  поверх расписания.
- **Heading lock на компас при низкой скорости.** `coords.heading` нестабилен
  ниже 0.5 м/с; в этом слайсе просто держим прежний bearing.
- **Поиск ближайшей альтернативы.** Только текущий маршрут + recompute от
  текущей позиции.
- **Сохранение прогресса между переходами по сайту.** Уход со страницы coin
  → ведение прекращается (controller.stop() в useEffect cleanup).

## Деплой

Web-only: `npm run build && pm2 restart trientes-web && pm2 save`.
Worker не трогаем.
