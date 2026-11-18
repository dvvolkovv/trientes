/**
 * «Это моё предприятие» — заявка на точку зеркала BTC Map.
 *
 * На карте большинство булавок чужие: это точки OpenStreetMap, которые кто-то
 * когда-то отметил тегом «принимаем крипту». У такой точки нет ни хозяина, ни
 * логотипа, ни рассказа о себе — карточка показывает адрес и часы и молчит.
 * Заведение, которое хочет говорить с посетителем само, забирает свою точку: мы
 * заводим ему `CompanyPoint` с теми же координатами и ключом зеркальной точки,
 * проводим через ту же модерацию, что и любую новую точку, а после одобрения
 * прячем зеркальную — одно заведение, одна булавка.
 *
 * Чистая часть вся здесь: ключ, его разбор и перенос тегов OSM в поля формы.
 * Заполняет форму **наше зеркало**, а не браузер заявителя: имя и адрес приходят
 * от нас, и подменить их нажатием на кнопку нельзя.
 */

import {
  acceptedCoinsFromTags,
  GENERIC_CRYPTO_TAGS,
  safeHttpUrl,
} from "@/lib/crypto-map";

// Ключ и его написания живут отдельно: их читает и браузер (карточка точки),
// а этот модуль тянет `crypto-map` с `node:dns` и в клиент не попадает.
export { isOsmPoiKey, poiIdToOsmKey, osmKeyToPoiId } from "@/lib/osm-key";

export type ClaimPrefill = {
  type: "SHOP" | "ATM";
  name: string;
  description: string | null;
  countryCode: string;
  city: string;
  street: string;
  houseNumber: string;
  postalCode: string;
  openingHours: string | null;
  phone: string | null;
  website: string | null;
  /** Монеты, названные тегами точки (id каталога). Проверяются по базе при записи. */
  acceptedCoinIds: string[];
  /** Тег «какая-то крипта» без тикера: показываем заявителю, в поля не пишем. */
  genericCrypto: boolean;
};

/**
 * Поля точки из тегов OSM. Банкомат отличается от магазина только тегами, и
 * тип подставляется по ним же — заявитель его всё равно может сменить в
 * кабинете, а мы не обязаны угадывать молча.
 */
export function claimPrefillFromTags(tags: Record<string, string>): ClaimPrefill {
  const isAtm =
    tags.amenity === "atm" ||
    tags.amenity === "bureau_de_change" ||
    tags.atm === "yes";
  const name =
    tags.name?.trim() ||
    tags.operator?.trim() ||
    tags.brand?.trim() ||
    (isAtm ? "Crypto ATM" : "");
  return {
    type: isAtm ? "ATM" : "SHOP",
    name,
    description: tags.description?.trim() || null,
    countryCode: (tags["addr:country"] ?? "").trim().toUpperCase().slice(0, 2),
    city: (tags["addr:city"] ?? "").trim(),
    street: (tags["addr:street"] ?? "").trim(),
    houseNumber: (tags["addr:housenumber"] ?? "").trim(),
    postalCode: (tags["addr:postcode"] ?? "").trim(),
    openingHours: tags.opening_hours?.trim() || null,
    phone: (tags["contact:phone"] ?? tags.phone ?? "").trim() || null,
    website: safeHttpUrl(tags.website || tags["contact:website"] || tags.url || null),
    acceptedCoinIds: acceptedCoinsFromTags(tags).map((c) => c.key),
    genericCrypto: GENERIC_CRYPTO_TAGS.some((t) => tags[t] === "yes"),
  };
}

/**
 * Можно ли ещё забрать эту точку. Отклонённая заявка делу не мешает: заведение
 * вправе подать снова, исправив то, из-за чего отказали. А вот ожидающая и
 * одобренная значат, что точка уже чья-то.
 */
export function claimBlockedBy(
  existing: readonly { status: string; deletedAt: Date | null }[],
): "pending" | "taken" | null {
  const live = existing.filter((p) => p.deletedAt === null);
  if (live.some((p) => p.status === "APPROVED")) return "taken";
  if (live.some((p) => p.status === "PENDING")) return "pending";
  return null;
}
