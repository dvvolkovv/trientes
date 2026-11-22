// Pure validation for company profiles and point submissions. No I/O.

import { isEmptyWeek, parseWeekHours, type WeekHours } from "@/lib/opening-hours";
import { isKnownTimezone } from "@/lib/timezones";
import { isMerchantCategory } from "@/lib/merchant-categories";
import { isIndustry, INDUSTRY_CUSTOM_MAX } from "@/lib/industries";
import { isLogoFit, isLogoShape } from "@/lib/company-logo";
import { hasLink } from "@/lib/promos/rules";
import { normalizeRequisite } from "@/lib/company-requisites";
import { splitIdList } from "@/lib/id-list";

const POINT_TYPES = ["SHOP", "ATM", "POS", "SALES_OFFICE", "COMPANY", "ONLINE"] as const;
export type PointTypeStr = (typeof POINT_TYPES)[number];

/** Потолок на точку: больше — это уже не «что я принимаю», а спам каталогом. */
export const MAX_ACCEPTED_CARDS = 50;

// Accepts "https://x.com", "http://x.com", "www.x.com", or bare "x.com".
// Returns the canonical https:// form, or "invalid" if the input is unusable.
function normalizeUrl(raw: string | null | undefined): string | null | "invalid" {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/\s/.test(s)) return "invalid";
  // Already has a scheme — accept only http/https.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "invalid";
      return u.toString().replace(/\/$/, "");
    } catch {
      return "invalid";
    }
  }
  // No scheme — must look like a domain (contains a dot, ≥2 chars per label).
  const stripped = s.replace(/^www\./i, "");
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([/?#].*)?$/i.test(stripped)) return "invalid";
  try {
    const u = new URL(`https://${s}`);
    if (u.protocol !== "https:") return "invalid";
    return u.toString().replace(/\/$/, "");
  } catch {
    return "invalid";
  }
}

/**
 * Адрес логотипа: наш собственный файл или чужая ссылка.
 *
 * Поймано живым прогоном BU: загрузка логотипа пишет в поле **наш** путь
 * (`/uploads/companies/…`), а `normalizeUrl` требует схему или домен — и
 * сохранение карточки сразу после загрузки отвергалось как «некорректный URL
 * логотипа». То есть загрузить логотип было можно, а сохранить карточку после
 * этого — нельзя.
 *
 * Принимаем только **наши** публичные корни и только безопасное имя: `/uploads/`
 * из ввода человека — это путь на нашем домене, и чужую строку туда пускать
 * незачем.
 */
function normalizeOwnOrRemoteUrl(raw: string | null | undefined): string | null | "invalid" {
  const s = (raw ?? "").trim();
  if (s.startsWith("/uploads/")) {
    return /^\/uploads\/[a-z0-9-]+\/[A-Za-z0-9_-]+\/[0-9a-f]{24}\.(png|jpg|jpeg|webp)$/.test(s)
      ? s
      : "invalid";
  }
  return normalizeUrl(s);
}

type StructuredAddress = {
  countryCode: string | null;
  city: string | null;
  street: string | null;
  houseNumber: string | null;
  postalCode: string | null;
};

/** Выводимая строка адреса из структурных частей. Один источник на весь проект. */
export function displayAddress(a: {
  street: string | null; houseNumber: string | null;
  postalCode: string | null; city: string | null; country: string | null;
}): string | null {
  return buildDisplayAddress(
    { street: a.street, houseNumber: a.houseNumber, postalCode: a.postalCode, city: a.city, countryCode: null },
    a.country,
  );
}

function buildDisplayAddress(a: StructuredAddress, countryName: string | null): string | null {
  const line1 = [a.street, a.houseNumber].map((x) => x?.trim()).filter(Boolean).join(" ");
  const line2 = [a.postalCode, a.city].map((x) => x?.trim()).filter(Boolean).join(" ");
  const parts = [line1, line2, countryName?.trim()].filter((x) => x && x.length > 0);
  return parts.length ? parts.join(", ") : null;
}

const t = (v: string | null | undefined) => { const s = (v ?? "").trim(); return s ? s : null; };

// ISO-3166 alpha-2: 2 ascii letters.
function normalizeCountryCode(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

export type CompanyProfileInput = {
  legalName?: string | null;
  displayName?: string | null;
  description?: string | null;
  country?: string | null;
  countryCode?: string | null;
  city?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  postalCode?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  /** Вид заведения (слайс BN) — ключ реестра `merchant-categories`. */
  category?: string | null;
  /** Политика возврата: обязательна к показу (ТЗ § 3.1), но не к заполнению. */
  returnPolicy?: string | null;
  returnDays?: string | number | null;
  /** Слайс BU: отрасль, своя рубрика, вид логотипа, часы конторы. */
  industry?: string | null;
  industryCustom?: string | null;
  logoShape?: string | null;
  logoFit?: string | null;
  hours?: unknown;
  timezone?: string | null;
  /** Слайс BV: публичные реквизиты. Класс правки — документальный. */
  registrationNumber?: string | null;
  taxNumber?: string | null;
  /** Слайс BX: набор монет предприятия, который наследуют его точки. */
  acceptedCoinIds?: string[] | null;
  acceptedCardIds?: string[] | null;
};
export type ValidatedProfile = {
  legalName: string; displayName: string; description: string | null;
  country: string | null; countryCode: string | null;
  city: string | null; street: string | null; houseNumber: string | null; postalCode: string | null;
  address: string | null; phone: string | null; email: string | null; website: string | null; logoUrl: string | null;
  category: string | null; returnPolicy: string | null; returnDays: number | null;
  industry: string | null; industryCustom: string | null;
  logoShape: string | null; logoFit: string | null;
  hours: WeekHours | null; timezone: string | null;
  registrationNumber: string | null; taxNumber: string | null;
  /** Слайс BX: набор монет предприятия, который наследуют его точки. */
  acceptedCoinIds: string[]; acceptedCardIds: string[];
};
export type ProfileResult =
  | { ok: true; data: ValidatedProfile }
  | {
      ok: false;
      reason:
        | "legal_name_required"
        | "display_name_required"
        | "website_invalid"
        | "logo_invalid"
        | "category_invalid"
        | "return_days_invalid"
        | "industry_invalid"
        | "industry_custom_has_link"
        | "hours_empty"
        | "timezone_invalid"
        | "registration_number_invalid"
        | "tax_number_invalid";
    };

/** Предел текста политики возврата: это условия, а не договор на сто страниц. */
export const RETURN_POLICY_MAX = 2000;

export function validateCompanyProfile(input: CompanyProfileInput): ProfileResult {
  const legalName = (input.legalName ?? "").trim();
  const displayName = (input.displayName ?? "").trim();
  if (!legalName) return { ok: false, reason: "legal_name_required" };
  if (!displayName) return { ok: false, reason: "display_name_required" };
  const website = normalizeUrl(input.website);
  if (website === "invalid") return { ok: false, reason: "website_invalid" };
  const logoUrl = normalizeOwnOrRemoteUrl(input.logoUrl);
  if (logoUrl === "invalid") return { ok: false, reason: "logo_invalid" };
  const structured: StructuredAddress = {
    countryCode: normalizeCountryCode(input.countryCode),
    city: t(input.city), street: t(input.street),
    houseNumber: t(input.houseNumber), postalCode: t(input.postalCode),
  };
  // Prefer explicit `address` if provided; otherwise build from structured parts.
  const address = t(input.address) ?? buildDisplayAddress(structured, t(input.country));

  const category = t(input.category);
  if (category !== null && !isMerchantCategory(category)) {
    return { ok: false, reason: "category_invalid" };
  }

  // Срок без текста законен («14 дней»), и текст без срока тоже: одно без другого
  // покупателю всё равно что-то говорит, а требовать оба значило бы, что не будет
  // ни одного.
  let returnDays: number | null = null;
  if (input.returnDays !== null && input.returnDays !== undefined && String(input.returnDays).trim() !== "") {
    const n = Number(input.returnDays);
    if (!Number.isInteger(n) || n < 0 || n > 365) return { ok: false, reason: "return_days_invalid" };
    returnDays = n;
  }

  const returnPolicy = t(input.returnPolicy)?.slice(0, RETURN_POLICY_MAX) ?? null;

  // Отрасль — ключ закрытого реестра: выдуманный попал бы в фильтр каталога и
  // показался бы покупателю как наша рубрика (тот же разбор, что `category`).
  const industry = t(input.industry);
  if (industry !== null && !isIndustry(industry)) return { ok: false, reason: "industry_invalid" };

  // Своя рубрика — слово продавца о себе, но ссылок в ней нет: текст выходит с
  // нашего домена, значит за ссылку в нём отвечаем мы (правило BG).
  const industryCustom = t(input.industryCustom)?.slice(0, INDUSTRY_CUSTOM_MAX) ?? null;
  if (industryCustom !== null && hasLink(industryCustom)) {
    return { ok: false, reason: "industry_custom_has_link" };
  }

  const logoShape = isLogoShape(input.logoShape) ? input.logoShape : null;
  const logoFit = isLogoFit(input.logoFit) ? input.logoFit : null;

  // Часы конторы. Семь закрытых дней — не «закрыто навсегда», а расписание, из
  // которого ничего не следует (правило BN): отвергаем вслух.
  const hours = parseWeekHours(input.hours);
  if (hours !== null && isEmptyWeek(hours)) return { ok: false, reason: "hours_empty" };
  const timezone = t(input.timezone);
  if (timezone !== null && !isKnownTimezone(timezone)) return { ok: false, reason: "timezone_invalid" };

  // Реквизиты (слайс BV). Формат по странам не проверяем — проверяем длину, ссылку и
  // управляющие знаки; разбор один на оба номера, чтобы правила не разошлись.
  const reg = normalizeRequisite(input.registrationNumber);
  if (!reg.ok) return { ok: false, reason: "registration_number_invalid" };
  const tax = normalizeRequisite(input.taxNumber);
  if (!tax.ok) return { ok: false, reason: "tax_number_invalid" };

  return {
    ok: true,
    data: {
      legalName, displayName, description: t(input.description),
      country: t(input.country), ...structured, address,
      phone: t(input.phone), email: t(input.email), website, logoUrl,
      category, returnPolicy, returnDays,
      industry, industryCustom, logoShape, logoFit, hours, timezone,
      registrationNumber: reg.value, taxNumber: tax.value,
      // Набор монет предприятия (слайс BX). Ключи чистим тем же правилом, что в
      // правке: пустые строки и повторы до базы доезжать не должны.
      acceptedCoinIds: [...new Set(splitIdList(input.acceptedCoinIds))],
      acceptedCardIds: [...new Set(splitIdList(input.acceptedCardIds))],
    },
  };
}

export type CompanyPointInput = {
  type?: string | null;
  name?: string | null;
  description?: string | null;
  lat?: number | null;
  lon?: number | null;
  countryCode?: string | null;
  city?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  postalCode?: string | null;
  address?: string | null;
  acceptedCoinIds?: string[] | null;
  acceptedCardIds?: string[] | null;
  logoUrl?: string | null;
  photos?: { url: string; label?: string | null }[] | null;
  openingHours?: string | null;
  /** Расписание по дням (слайс BN) — в том виде, в каком его отдаёт форма. */
  hours?: unknown;
  timezone?: string | null;
  category?: string | null;
  phone?: string | null;
  website?: string | null;
};
export type PointPhoto = { url: string; label: string | null };
export type ValidatedPoint = {
  type: PointTypeStr; name: string; description: string | null;
  // Online-only services skip coords entirely; everything else must have them.
  lat: number | null; lon: number | null;
  countryCode: string | null; city: string | null; street: string | null;
  houseNumber: string | null; postalCode: string | null;
  address: string | null; acceptedCoinIds: string[]; acceptedCardIds: string[];
  logoUrl: string | null;
  photos: PointPhoto[];
  openingHours: string | null; phone: string | null; website: string | null;
  hours: WeekHours | null; timezone: string | null; category: string | null;
};

// Storefront photos: keep first 5, drop any URL that isn't http(s) or a local
// /uploads/ path. Label trimmed to 80 chars to keep popups tidy.
export function sanitizePointPhotos(raw: unknown): PointPhoto[] {
  if (!Array.isArray(raw)) return [];
  const out: PointPhoto[] = [];
  for (const item of raw) {
    if (out.length >= 5) break;
    if (!item || typeof item !== "object") continue;
    const url = (item as { url?: unknown }).url;
    const label = (item as { label?: unknown }).label;
    if (typeof url !== "string" || !url.trim()) continue;
    const trimmed = url.trim();
    let ok = false;
    if (trimmed.startsWith("/uploads/")) ok = true;
    else {
      try {
        const u = new URL(trimmed);
        ok = u.protocol === "http:" || u.protocol === "https:";
      } catch { ok = false; }
    }
    if (!ok) continue;
    const cleanLabel = typeof label === "string" && label.trim() ? label.trim().slice(0, 80) : null;
    out.push({ url: trimmed, label: cleanLabel });
  }
  return out;
}
export type PointResult =
  | { ok: true; data: ValidatedPoint }
  | {
      ok: false;
      reason:
        | "type_invalid"
        | "name_required"
        | "coords_invalid"
        | "website_invalid"
        | "logo_invalid"
        | "hours_invalid"
        | "hours_empty"
        | "timezone_invalid"
        | "category_invalid";
    };

export function validateCompanyPoint(input: CompanyPointInput): PointResult {
  const type = (input.type ?? "") as PointTypeStr;
  if (!POINT_TYPES.includes(type)) return { ok: false, reason: "type_invalid" };
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, reason: "name_required" };

  // ONLINE-only services have no physical location, so coords are skipped.
  // Anything physical (shop / ATM / POS / sales office / company HQ) still
  // needs a valid pair so the navigator can pin it.
  let lat: number | null = null;
  let lon: number | null = null;
  if (type !== "ONLINE") {
    if (input.lat == null || input.lon == null) return { ok: false, reason: "coords_invalid" };
    const la = Number(input.lat);
    const lo = Number(input.lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180)
      return { ok: false, reason: "coords_invalid" };
    if (la === 0 && lo === 0) return { ok: false, reason: "coords_invalid" }; // Null Island
    lat = la; lon = lo;
  }

  const website = normalizeUrl(input.website);
  if (website === "invalid") return { ok: false, reason: "website_invalid" };
  const logoUrl = normalizeOwnOrRemoteUrl(input.logoUrl);
  if (logoUrl === "invalid") return { ok: false, reason: "logo_invalid" };
  const acceptedCoinIds = Array.from(
    new Set((input.acceptedCoinIds ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean)),
  );
  // Id карточки — это cuid, регистр значащий. В отличие от id CoinGecko его
  // нельзя приводить к нижнему регистру: ссылка перестанет совпадать.
  const acceptedCardIds = Array.from(
    new Set((input.acceptedCardIds ?? []).map((c) => String(c).trim()).filter(Boolean)),
  ).slice(0, MAX_ACCEPTED_CARDS);
  const structured: StructuredAddress = {
    countryCode: normalizeCountryCode(input.countryCode),
    city: t(input.city), street: t(input.street),
    houseNumber: t(input.houseNumber), postalCode: t(input.postalCode),
  };
  const address = t(input.address) ?? buildDisplayAddress(structured, null);

  // Вид заведения — только ключ нашего реестра: выдуманный покрасил бы булавку и
  // попал бы в интересы маршрута, то есть соврал бы о том, что это за место.
  const rawCategory = t(input.category);
  if (rawCategory !== null && !isMerchantCategory(rawCategory)) {
    return { ok: false, reason: "category_invalid" };
  }

  // Часы есть и у онлайн-услуги (слайс BU): «работаем круглосуточно» — это
  // утверждение продавца, а не умолчание, и сказать его должен он. Пояс нужен
  // затем же, зачем у двери: без него «открыто сейчас» считалось бы по часам
  // сервера. Прежде оба поля у `ONLINE` молча обнулялись — и редактор, который
  // слайс BU показал, сохранял бы в пустоту.
  const rawHours = input.hours;
  let hours: WeekHours | null = null;
  const hoursGiven =
    rawHours !== null &&
    rawHours !== undefined &&
    !(typeof rawHours === "object" && Object.keys(rawHours as object).length === 0);
  if (hoursGiven) {
    hours = parseWeekHours(rawHours);
    if (!hours) return { ok: false, reason: "hours_invalid" };
    // Семь закрытых дней — это не «закрыто навсегда», а расписание, из которого
    // ничего не следует: точка стоит на карте, и постоянное «закрыто» было бы
    // либо ложью, либо бессмыслицей. Отказываем вслух, а не принимаем молча.
    if (isEmptyWeek(hours)) return { ok: false, reason: "hours_empty" };
  }

  const timezone = t(input.timezone);
  if (timezone !== null && !isKnownTimezone(timezone)) {
    return { ok: false, reason: "timezone_invalid" };
  }

  return {
    ok: true,
    data: {
      type, name, description: t(input.description), lat, lon, ...structured, address,
      acceptedCoinIds, acceptedCardIds, logoUrl,
      photos: sanitizePointPhotos(input.photos),
      openingHours: t(input.openingHours), phone: t(input.phone), website,
      hours, timezone, category: rawCategory,
    },
  };
}
