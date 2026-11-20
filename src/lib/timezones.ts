/**
 * Часовой пояс точки продаж (слайс BN).
 *
 * Список поясов берём **у платформы** (`Intl.supportedValuesOf("timeZone")`): своя
 * таблица зон отстала бы от переводов летнего времени, а Node обновляет базу tzdata
 * сам. Карта стран здесь только для подстановки: у Чехии пояс один, и спрашивать
 * его — лишний вопрос, а у США их шесть, и угадывать нельзя.
 *
 * По координатам пояс не выводим: поиска по границам зон в платформе нет, а тянуть
 * базу границ ради одного поля — отдельное решение.
 */

let cached: string[] | null = null;

/** Все пояса, которые знает платформа. */
export function allTimezones(): string[] {
  if (cached) return cached;
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
    .supportedValuesOf;
  cached = typeof supported === "function" ? supported.call(Intl, "timeZone") : ["UTC"];
  return cached;
}

export function isKnownTimezone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    // Платформа — единственный судья: негодная зона бросает на создании форматтера.
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Страны с единственным часовым поясом. Португалии, Испании, Новой Зеландии,
 * Эквадора и Чили здесь нет намеренно: у них есть острова со своим поясом, и
 * подстановка материкового значения была бы тихой ошибкой у островного магазина.
 */
const SINGLE_ZONE: Record<string, string> = {
  AD: "Europe/Andorra", AE: "Asia/Dubai", AL: "Europe/Tirane", AM: "Asia/Yerevan",
  AT: "Europe/Vienna", AZ: "Asia/Baku", BA: "Europe/Sarajevo", BD: "Asia/Dhaka",
  BE: "Europe/Brussels", BG: "Europe/Sofia", BH: "Asia/Bahrain", BO: "America/La_Paz",
  BY: "Europe/Minsk", CH: "Europe/Zurich", CN: "Asia/Shanghai", CO: "America/Bogota",
  CR: "America/Costa_Rica", CU: "America/Havana", CY: "Asia/Nicosia", CZ: "Europe/Prague",
  DE: "Europe/Berlin", DK: "Europe/Copenhagen", DO: "America/Santo_Domingo",
  DZ: "Africa/Algiers", EE: "Europe/Tallinn", EG: "Africa/Cairo", FI: "Europe/Helsinki",
  FR: "Europe/Paris", GB: "Europe/London", GE: "Asia/Tbilisi", GH: "Africa/Accra",
  GI: "Europe/Gibraltar", GR: "Europe/Athens", GT: "America/Guatemala",
  HK: "Asia/Hong_Kong", HN: "America/Tegucigalpa", HR: "Europe/Zagreb",
  HU: "Europe/Budapest", IE: "Europe/Dublin", IL: "Asia/Jerusalem", IN: "Asia/Kolkata",
  IS: "Atlantic/Reykjavik", IT: "Europe/Rome", JM: "America/Jamaica", JO: "Asia/Amman",
  JP: "Asia/Tokyo", KE: "Africa/Nairobi", KH: "Asia/Phnom_Penh", KR: "Asia/Seoul",
  KW: "Asia/Kuwait", LA: "Asia/Vientiane", LB: "Asia/Beirut", LI: "Europe/Vaduz",
  LK: "Asia/Colombo", LT: "Europe/Vilnius", LU: "Europe/Luxembourg", LV: "Europe/Riga",
  MA: "Africa/Casablanca", MC: "Europe/Monaco", MD: "Europe/Chisinau",
  ME: "Europe/Podgorica", MK: "Europe/Skopje", MM: "Asia/Yangon", MT: "Europe/Malta",
  MY: "Asia/Kuala_Lumpur", NG: "Africa/Lagos", NI: "America/Managua",
  NL: "Europe/Amsterdam", NO: "Europe/Oslo", NP: "Asia/Kathmandu", OM: "Asia/Muscat",
  PA: "America/Panama", PE: "America/Lima", PH: "Asia/Manila", PK: "Asia/Karachi",
  PL: "Europe/Warsaw", PY: "America/Asuncion", QA: "Asia/Qatar", RO: "Europe/Bucharest",
  RS: "Europe/Belgrade", SA: "Asia/Riyadh", SE: "Europe/Stockholm", SG: "Asia/Singapore",
  SI: "Europe/Ljubljana", SK: "Europe/Bratislava", SM: "Europe/San_Marino",
  SV: "America/El_Salvador", TH: "Asia/Bangkok", TN: "Africa/Tunis", TR: "Europe/Istanbul",
  TW: "Asia/Taipei", UA: "Europe/Kyiv", UY: "America/Montevideo", VA: "Europe/Vatican",
  VE: "America/Caracas", VN: "Asia/Ho_Chi_Minh", ZA: "Africa/Johannesburg",
};

/**
 * Имя зоны в том виде, в каком её называет платформа. Нужно потому, что у зоны
 * бывает два имени: `Europe/Kyiv` и `Europe/Kiev`, `Asia/Kolkata` и `Asia/Calcutta`.
 * Оба рабочие, но в списке `supportedValuesOf` лежит ровно одно — то, которое знает
 * установленная база tzdata, — и подставленное второе не нашлось бы в выпадающем
 * списке: человек увидел бы пустой выбор вместо своего пояса.
 */
export function canonicalTimezone(tz: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Пояс страны, если он единственный. Иначе `null` — выбирает мерчант. */
export function timezoneForCountry(code: string | null | undefined): string | null {
  if (!code) return null;
  const tz = SINGLE_ZONE[code.trim().toUpperCase()];
  if (!tz) return null;
  const canon = canonicalTimezone(tz);
  // Имя из карты годится и само, но в списке платформы лежит каноническое.
  return canon && allTimezones().includes(canon) ? canon : tz;
}

export const SINGLE_ZONE_COUNTRIES = SINGLE_ZONE;
