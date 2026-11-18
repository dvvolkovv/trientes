import { SUPPORTED_LOCALES, type Locale } from "@/lib/locales";

/**
 * Ссылки на обмен (/exchange/, отдельный фронт — репозиторий trientes-dex-ui).
 *
 * Язык передаётся обмену параметром `lang`: у страницы обмена свой переключатель
 * языка и своя память выбора, и у неё те же одиннадцать языков, что у сайта
 * (`SUPPORTED_LOCALES` ↔ `LANGS` там), причём `?lang=` перебивает запомненный
 * выбор. Поэтому локаль уходит как есть — до 2026-11-12 здесь стояло `ru` или
 * `en`, и человек, читающий сайт по-японски, попадал на обмен по-английски.
 *
 * Чужое значение не передаём вовсе: обмен молча откатится на свой язык по
 * умолчанию, и лучше не писать в адрес то, чего страница не знает.
 */
function isSiteLocale(locale: string): locale is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

/** Ссылка на экран обмена из меню сайта — пара по умолчанию. */
export function dexHref(locale: string): string {
  return isSiteLocale(locale) ? `/exchange/?lang=${locale}#/swap` : "/exchange/#/swap";
}

/**
 * Сумма в $, как её принимает служба пожертвований (`AMOUNT_USD` в
 * `donateApi.ts` обмена): от 1 до 999 999, не больше двух знаков после точки.
 * Правило живёт у ссылки: в адрес не должна попадать сумма, которую экран
 * пожертвований всё равно отвергнет — тогда он просто откроется с пустым полем.
 */
const AMOUNT_USD = /^[1-9][0-9]{0,5}(\.[0-9]{1,2})?$/;

/**
 * Ссылка на экран пожертвований обмена (`#/donate`). `amountUsd` — сумма,
 * которую экран подставит в поле; негодная сумма отбрасывается, а не уходит в
 * адрес.
 */
export function donateHref(locale: string, amountUsd?: string): string {
  const amount = amountUsd !== undefined && AMOUNT_USD.test(amountUsd) ? amountUsd : null;
  const hash = amount === null ? "#/donate" : `#/donate?amount=${encodeURIComponent(amount)}`;
  return isSiteLocale(locale) ? `/exchange/?lang=${locale}${hash}` : `/exchange/${hash}`;
}

/**
 * Язык сайта в уже готовом адресе обмена.
 *
 * Адрес рынка нашего обмена лежит в базе (`CoinCardMarket.tradeUrl`, его пишет
 * прогон слайса AE) и языка не несёт и нести не может: строка одна на все
 * одиннадцать локалей. Значит, язык добавляет рендер — иначе человек, читающий
 * карточку по-японски, уходит из «Рынков» на обмен по-русски (там это язык по
 * умолчанию).
 *
 * Трогаем только свой обмен: путь должен быть ровно `/exchange/`. Ссылка чужой
 * биржи, у которой в адресе тоже встречается слово exchange (`crypto.com/
 * exchange/document/...`), остаётся как есть — дописывать свой параметр в чужой
 * адрес нельзя.
 */
export function dexUrlWithLang(url: string, locale: string): string {
  if (!isSiteLocale(locale)) return url;
  const hashAt = url.indexOf("#");
  const head = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  const queryAt = head.indexOf("?");
  const path = queryAt === -1 ? head : head.slice(0, queryAt);
  if (!/\/exchange\/?$/.test(path)) return url;
  const params = new URLSearchParams(queryAt === -1 ? "" : head.slice(queryAt + 1));
  params.set("lang", locale);
  return `${path}?${params.toString()}${hash}`;
}
