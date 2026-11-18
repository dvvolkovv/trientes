/**
 * Ключ точки зеркала BTC Map в двух написаниях.
 *
 * `node:123` — так точка лежит у нас (`OsmCryptoPoi.id`) и так она стоит в
 * адресе страницы «это моё предприятие»; `node/123` — так она приходит в фиде
 * (написание родилось из Overpass). Перевод держим в одном месте, иначе два
 * написания разойдутся.
 *
 * Отдельный крошечный модуль, а не часть `point-claim`: ключ нужен и карточке
 * точки в браузере, а `point-claim` тянет за собой `crypto-map` с `node:dns`
 * — в клиентскую сборку такой импорт не проходит вовсе.
 */

const KEY_RE = /^(node|way|relation):[0-9]{1,20}$/;

export function isOsmPoiKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function poiIdToOsmKey(poiId: string): string | null {
  const key = poiId.replace("/", ":");
  return isOsmPoiKey(key) ? key : null;
}

export function osmKeyToPoiId(key: string): string | null {
  return isOsmPoiKey(key) ? key.replace(":", "/") : null;
}
