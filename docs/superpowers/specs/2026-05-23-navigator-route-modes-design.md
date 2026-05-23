# Navigator: маршруты пешком / авто / общественный транспорт

**Дата:** 2026-05-23
**Раздел:** Crypto Navigator (`/{locale}/coin/{slug}#navigator`)

## Задача

Дать пользователю строить маршрут от его позиции (геолокация или адрес) до точки на
карте, где принимают криптовалюту, в трёх режимах:

- 🚶 **Пешком**
- 🚗 **На личном автомобиле**
- 🚍 **На общественном транспорте**

Сейчас маршрут строится только на автомобиле (публичный OSRM demo, профиль `driving`).

## Подход (всё key-less, в духе проекта)

| Режим | Движок | Эндпоинт | Формат |
|---|---|---|---|
| walk | FOSSGIS OSRM | `routing.openstreetmap.de/routed-foot/route/v1/foot/{lon,lat;lon,lat}` | OSRM (как сейчас) |
| car | FOSSGIS OSRM | `routing.openstreetmap.de/routed-car/route/v1/driving/{lon,lat;lon,lat}` | OSRM |
| transit | Transitous / MOTIS | `api.transitous.org/api/v1/plan?fromPlace=lat,lon&toPlace=lat,lon&transitModes=TRANSIT,WALK` | MOTIS itineraries |

Замена нынешнего `router.project-osrm.org` на FOSSGIS-инстансы даёт пешеходный
профиль (на demo OSRM его нет) и единый стабильный хост для walk+car.

**Проверено вживую (2026-05-23, координаты Вены):** все три эндпоинта отвечают 200;
OSRM отдаёт `routes[0].geometry.coordinates` (GeoJSON) + `distance`/`duration`;
MOTIS отдаёт `itineraries[]`, каждая с `duration`, `transfers`, `legs[]`, где у ноги
есть `mode` (WALK/SUBWAY/BUS/TRAM/RAIL…), `routeShortName` (напр. «U4») и
`legGeometry.points` — encoded polyline **precision 7**.

## Изменения в коде

### `src/lib/crypto-map.ts`
- `export type RouteMode = "walk" | "car" | "transit"`.
- `OsrmRoute = { distance; duration; geometry }` — то, что возвращает `parseOsrm`
  (существующий unit-тест на форму сохраняется).
- `RouteResult = OsrmRoute & { mode: RouteMode; transfers?: number; legs?: TransitLeg[] }`.
- `TransitLeg = { mode: string; line: string | null; from: string | null; to: string | null; duration: number; dashed: boolean; color: string; coordinates: [number,number][] }`.
- `decodePolyline(s, precision=7): [number,number][]` — чистая, возвращает [lon,lat]
  (GeoJSON-порядок). Алгоритм Google polyline. **Юнит-тест.**
- `parseMotis(raw): RouteResult | null` — чистая: берёт первую `itinerary`, декодирует
  геометрию каждой ноги, склеивает в общий `geometry.coordinates`, собирает `legs[]`,
  `transfers`, `duration`; расстояние — сумма по ногам (приблизительно). **Юнит-тест.**
- `fetchRoute(from, to, mode = "car", timeoutMs)` — ветвление на 3 движка; для MOTIS
  переворачивает порядок в `lat,lon`. Мягкая деградация (как сейчас): null при сбое.

### `src/app/api/crypto-map/directions/route.ts`
- Параметр `&mode=walk|car|transit` (валидация enum; дефолт `car` — обратная совместимость).
- Ключ кэша включает режим; TTL: walk/car 3600 c, transit 900 c (зависит от времени).

### `src/components/coin-detail/crypto-navigator.tsx`
- Состояние режима (`modeRef` + `useState`), дефолт `walk`.
- Сегментный переключатель из 3 кнопок (🚶 / 🚗 / 🚍) в зоне маршрута; смена режима
  при наличии origin+dest перестраивает маршрут.
- `buildRoute` шлёт `&mode=`.
- Источник `route` → FeatureCollection. Две линии-слоя:
  - `route-line` (сплошная, цвет из свойства `color`, дефолт акцент) — фильтр `dashed != true`;
  - `route-walk` (пунктир, серая) — фильтр `dashed == true` (пешие связки транзита).
  Цвет ноги транзита по `mode`: SUBWAY/RAIL — синий, BUS — зелёный, TRAM — оранжевый.
- Сводка по режиму: walk/car — расстояние + время; transit — общее время, число
  пересадок и компактная цепочка ног (🚶 → 🚇 U4 → 🚶).

### `messages/*.json` (10 локалей)
Новые ключи в `cryptoMap`: `modeWalk`, `modeCar`, `modeTransit`, `transfers` (ICU plural),
`transitDirect`, `noTransit`. Обновить `dataNote` (упомянуть Transitous для транзита).

## Краёвые случаи / деградация
- Транзит без покрытия (пустой `itineraries`) → подсказка `noTransit` + предложение пешком.
- Любой движок недоступен → пустая сводка, без падения (как сейчас).
- Обратная совместимость: вызов API без `mode` ведёт себя как раньше (авто).

## Тестирование
- Юнит: `decodePolyline` (известная строка → координаты), `parseMotis` (синтетическая
  itinerary → склеенная геометрия + legs + transfers), `parseOsrm` (без изменений).
- Сборка + typecheck. Ручная проверка маршрута трёх режимов в Вене (Sangita).

## Деплой
Прод — этот checkout. `npm run build` → `pm2 restart trientes-web` **и**
`trientes-worker` (менялся `src/lib`) → `pm2 save` → `git push origin main`.
