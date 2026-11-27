/**
 * Разбор того, что владелец вставил в поле «Ссылка на оплату» (задание, § 2.1).
 *
 * Разбираем **парсером адресов, а не регуляркой по строке**, и это главное решение
 * слайса. Регулярка «начинается на https://trientes.org/exchange/» читает
 * `https://trientes.org@evil.example/exchange/#/l/pl_…` как наш адрес — а это логин
 * `trientes.org` на чужом хосте, то есть ссылка ведёт к чужому кошельку. `URL` читает
 * его правильно, потому что он и есть определение того, куда пойдёт браузер.
 *
 * Снаружи обрезаем только пробелы ASCII; внутри **не нормализуем ничего**: нормализация
 * — это второй разбор, и он разошёлся бы с первым (та же причина, по которой в проекте
 * один список локалей и один реестр сетей EVM).
 *
 * Хранится и уходит дальше **только номер**: адрес кнопки «Оплатить» собирается из
 * постоянного шаблона, и введённая строка в `href` не попадает никогда.
 */
import { SUPPORTED_LOCALES, type Locale } from "@/lib/locales";

/**
 * Номер ссылки оплаты, как его делает служба. Регистр **значим**: `pl_Ab…` и `pl_ab…`
 * принадлежат разным магазинам, и «привести к нижнему» означало бы увести платежи.
 */
export const PAY_LINK_ID = /^pl_[0-9A-Za-z]{11}$/;

/** Хост ссылки оплаты. Один и постоянный — не из окружения и не из ввода. */
export const PAY_LINK_HOST = "trientes.org";
/** Путь страницы оплаты у нас. */
export const PAY_LINK_PATH = "/exchange/";
/** Кабинет магазина. Подключение заводит сам владелец, нас в этом шаге нет. */
export const PAY_CABINET_BASE = "https://pay.trientes.com/cabinet/";

export type PayLinkParse =
  | { ok: true; linkId: string }
  | { ok: false; reason: "empty" | "bad_link" };

const ASCII_EDGE_SPACE = /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g;

const isSiteLocale = (value: string): value is Locale =>
  (SUPPORTED_LOCALES as readonly string[]).includes(value);

/** Ровно `?lang=<язык из списка>` или пусто. Чужой язык — отказ, а не «забудем». */
function searchAllowed(search: string): boolean {
  if (search === "") return true;
  if (!search.startsWith("?lang=")) return false;
  return isSiteLocale(search.slice("?lang=".length));
}

/** Непроверенный ввод в номер ссылки. Принимается голый номер или наш адрес целиком. */
export function parsePayLinkInput(raw: string): PayLinkParse {
  const text = raw.replace(ASCII_EDGE_SPACE, "");
  if (text === "") return { ok: false, reason: "empty" };
  if (PAY_LINK_ID.test(text)) return { ok: true, linkId: text };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "bad_link" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "bad_link" };
  // Логин и пароль в адресе — тот самый `trientes.org@evil.example`.
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "bad_link" };
  // Порт: `URL` оставляет его пустым у порта по умолчанию, поэтому непустой — явный.
  if (url.port !== "") return { ok: false, reason: "bad_link" };
  // Регистр хоста не важен (`URL` его уже опустил), а точка в конце — другой хост.
  if (url.hostname !== PAY_LINK_HOST) return { ok: false, reason: "bad_link" };
  if (url.pathname !== PAY_LINK_PATH) return { ok: false, reason: "bad_link" };
  if (!searchAllowed(url.search)) return { ok: false, reason: "bad_link" };

  if (!url.hash.startsWith("#/l/")) return { ok: false, reason: "bad_link" };
  const id = url.hash.slice("#/l/".length);
  // Номер проверяется целиком: лишний хвост, второй номер, `..` и пробел внутри — всё
  // это уже не номер. Процентной записи здесь тоже нет: `URL` хеш не раскодирует, и
  // `%70l_…` просто не совпадёт с образцом.
  if (!PAY_LINK_ID.test(id)) return { ok: false, reason: "bad_link" };
  return { ok: true, linkId: id };
}

/**
 * Адрес кнопки «Оплатить»: постоянный шаблон, проверенный номер и язык страницы.
 * Чужая локаль уходит без `lang` — страница оплаты берёт его только точным
 * совпадением, и писать в адрес то, чего она не знает, незачем (правило `dexHref`).
 */
export function payHref(locale: string, linkId: string): string {
  const hash = `#/l/${linkId}`;
  return isSiteLocale(locale)
    ? `${PAY_LINK_PATH}?lang=${locale}${hash}`
    : `${PAY_LINK_PATH}${hash}`;
}

/** Куда ведёт «Подключить приём платежей»: кабинет магазина, шаг подключения. */
export function payCabinetHref(locale: string): string {
  return isSiteLocale(locale)
    ? `${PAY_CABINET_BASE}?lang=${locale}#/apply`
    : `${PAY_CABINET_BASE}#/apply`;
}
