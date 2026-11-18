/**
 * Штрихкод товара — опознавательный знак паспорта (спека
 * `docs/superpowers/specs/2026-11-18-product-passport-catalog-design.md`, раздел 5).
 * По нему две записи одного товара склеиваются сами: второе предприятие, набравшее тот
 * же код, попадает в существующий паспорт, а не заводит второй. Поэтому код обязан быть
 * настоящим, а не любыми тринадцатью цифрами: контрольная цифра проверяется, иначе
 * опечатка в одном знаке заводит паспорт-двойник, который потом сливать руками.
 */

/** Контрольная цифра GTIN: веса 3 и 1 справа налево, не считая саму цифру. */
function checkDigit(digits: string): number {
  let sum = 0;
  for (let i = digits.length - 1, weight = 3; i >= 0; i -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(digits[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Приводит набранное человеком к хранимому виду или отказывает.
 *
 * Принимаем EAN-13 и EAN-8 как есть, UPC-12 приводим к EAN-13 ведущим нулём: это один и
 * тот же товар, и два вида записи дали бы два паспорта. Пробелы и дефисы человек
 * переписывает с упаковки — их снимаем. Код из одних нулей не называет товара, он
 * отвергается отдельно: контрольная цифра у него сходится.
 */
export function parseGtin(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  if (/^0+$/.test(digits)) return null;

  const normalised = digits.length === 12 ? `0${digits}` : digits;
  if (normalised.length !== 13 && normalised.length !== 8) return null;

  const body = normalised.slice(0, -1);
  const given = Number(normalised.slice(-1));
  return checkDigit(body) === given ? normalised : null;
}
