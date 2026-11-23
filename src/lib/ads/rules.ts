/**
 * Рекламный материал баннера — чистые правила (слайс BY). Спека
 * `docs/superpowers/specs/2026-11-22-company-card-banner-ads-design.md`.
 *
 * Без Prisma: правило проверяется тестом, а не живым нажатием в кабинете.
 */

import { createHash } from "node:crypto";
import { hasLink } from "@/lib/promos/rules";
import { parsePaymentMethods, type PaymentMethodKey } from "@/lib/payment-methods";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/locales";

/** Опубликованных материалов в карусели. Шестую никто не долистает. */
export const MAX_PUBLISHED_ADS = 5;
/** Всего материалов на предприятие: черновики и архив читает человек списком. */
export const MAX_ADS = 50;

export const AD_TITLE_MAX = 80;
/** Та же граница, что у акции (BG): длинную рекламу не читают и не дослушивают. */
export const AD_BODY_MAX = 600;
export const AD_PROMO_CODE_MAX = 32;

export const MAX_AD_IMAGE_BYTES = 8 * 1024 * 1024;
/** Как у ролика товара (BB). Длительность не проверяем: `ffprobe` на машине нет. */
export const MAX_AD_VIDEO_BYTES = 30 * 1024 * 1024;
export const MAX_AD_AUDIO_BYTES = 10 * 1024 * 1024;

/** Правок в сутки на предприятие; счёт до работы, как `DAILY_MOVEMENTS` в BC. */
export const AD_EDITS_PER_DAY = 100;
/**
 * Озвучек в сутки на предприятие (слайс BZ). Синтез — платный вызов наружу, и
 * потолок тут не про спам, а про счёт: тридцать записей это тридцать материалов
 * с переделками, то есть больше, чем бывает за день живой работы.
 */
export const AD_VOICE_PER_DAY = 30;

/**
 * Голоса синтеза. Список — наш реестр, а не свободная строка: чужое слово ушло бы в
 * чужую службу и вернулось отказом, который человеку нечем объяснить.
 */
export const AD_VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse",
] as const;
export type AdVoice = (typeof AD_VOICES)[number];
export const AD_VOICE_DEFAULT: AdVoice = "sage";

export function isAdVoice(raw: unknown): raw is AdVoice {
  return typeof raw === "string" && (AD_VOICES as readonly string[]).includes(raw);
}

/**
 * Манера чтения. Инструкция уходит в модель вместе с текстом — это и есть разница
 * между диктором автоответчика и живым человеком. Пресеты в коде, как лист проверок
 * в AP: три слова должны одинаково звучать в студии и в карточке.
 */
export const AD_VOICE_STYLES = ["calm", "bright", "solemn"] as const;
export type AdVoiceStyle = (typeof AD_VOICE_STYLES)[number];
export const AD_VOICE_STYLE_DEFAULT: AdVoiceStyle = "calm";

export function isAdVoiceStyle(raw: unknown): raw is AdVoiceStyle {
  return typeof raw === "string" && (AD_VOICE_STYLES as readonly string[]).includes(raw);
}

/** Отпечаток озвученного текста: по нему видно, что текст с тех пор правили. */
export function adTextHash(title: string, body: string | null | undefined): string {
  return createHash("sha256").update(`${title.trim()}\u0000${(body ?? "").trim()}`).digest("hex").slice(0, 32);
}

/**
 * Устарела ли запись. Мерим только **свою** озвучку: присланную продавцом запись
 * нашим текстом не судим — это его голос и его дело. Молча переозвучивать нельзя
 * (чужие деньги), молча оставлять расхождение — тем более, поэтому рядом с записью
 * стоит честная строка.
 */
export function adVoiceStale(
  ad: { audioUrl: string | null; audioGenerated: boolean; audioTextHash: string | null },
  title: string,
  body: string | null | undefined,
): boolean {
  if (!ad.audioUrl || !ad.audioGenerated) return false;
  return ad.audioTextHash !== adTextHash(title, body);
}

export const AD_KINDS = ["PROMO", "EVENT", "NEWS"] as const;
export type AdKind = (typeof AD_KINDS)[number];

export const AD_ACTIONS = ["NONE", "PRODUCT", "WEBSITE", "POINT"] as const;
export type AdAction = (typeof AD_ACTIONS)[number];

export type AdInput = {
  kind: string;
  title: string;
  body: string;
  language: string;
  mediaKind: string;
  mediaUrl: string;
  posterUrl?: string | null;
  audioUrl?: string | null;
  /** Запись сделана нашим синтезом (слайс BZ), а не прислана продавцом. */
  audioGenerated?: boolean | null;
  audioVoice?: string | null;
  /**
   * Отпечаток текста на момент озвучки — приходит из ответа маршрута синтеза. Считать
   * его при сохранении нельзя: человек мог озвучить, потом поправить текст, и
   * посчитанный заново отпечаток объявил бы устаревшую запись свежей.
   */
  audioTextHash?: string | null;
  promoCode?: string | null;
  /** `YYYY-MM-DD`; пусто — показывается, пока опубликован. */
  startsAt?: string | null;
  endsAt?: string | null;
  /** `YYYY-MM-DD` у материала вида EVENT — начало. */
  eventAt?: string | null;
  /** Конец события; пусто — событие одного дня. */
  eventEndAt?: string | null;
  /** Место материала (слайс BZ): объект рекламы, а не точка приёма. */
  placeName?: string | null;
  placeAddress?: string | null;
  placeLat?: number | string | null;
  placeLon?: number | string | null;
  placeAcceptedCoinIds?: string[] | null;
  placeAcceptedCardIds?: string[] | null;
  placePaymentMethods?: string[] | null;
  action: string;
  productId?: string | null;
  pointId?: string | null;
  actionUrl?: string | null;
};

export type AdValues = {
  kind: AdKind;
  title: string;
  body: string | null;
  language: Locale;
  mediaKind: "IMAGE" | "VIDEO";
  mediaUrl: string;
  posterUrl: string | null;
  audioUrl: string | null;
  audioGenerated: boolean;
  audioVoice: string | null;
  audioTextHash: string | null;
  promoCode: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  eventAt: Date | null;
  eventEndAt: Date | null;
  placeName: string | null;
  placeAddress: string | null;
  placeLat: number | null;
  placeLon: number | null;
  placeAcceptedCoinIds: string[];
  placeAcceptedCardIds: string[];
  placePaymentMethods: PaymentMethodKey[];
  action: AdAction;
  productId: string | null;
  pointId: string | null;
  actionUrl: string | null;
};

export type AdParse = { ok: true; value: AdValues } | { ok: false; reason: string };
const fail = (reason: string): AdParse => ({ ok: false, reason });

const DAY = 24 * 60 * 60 * 1000;

function parseDay(raw: string, end: boolean): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return null;
  const ms = Date.parse(`${raw.trim()}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(end ? ms + DAY - 1 : ms);
}

/**
 * Наш же загруженный файл, а не чужой адрес: медиа баннера отдаёт nginx из нашего
 * корня, и чужая картинка в карточке означала бы и чужой счётчик посещений, и
 * исчезновение кадра в день, когда её уберут.
 */
export function isOwnMedia(url: string): boolean {
  return /^\/uploads\/ads\/[A-Za-z0-9_-]+\/[a-f0-9]{32}\.(png|jpg|webp|mp4|mp3|m4a|ogg)$/.test(url);
}

type PlaceValues = Pick<
  AdValues,
  | "placeName" | "placeAddress" | "placeLat" | "placeLon"
  | "placeAcceptedCoinIds" | "placeAcceptedCardIds" | "placePaymentMethods"
>;

const EMPTY_PLACE: PlaceValues = {
  placeName: null, placeAddress: null, placeLat: null, placeLon: null,
  placeAcceptedCoinIds: [], placeAcceptedCardIds: [], placePaymentMethods: [],
};

function idList(raw: string[] | null | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, 50);
}

function num(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Место материала (слайс BZ). Рекламируемый объект — не точка приёма: в фид карты он
 * не попадает, и поэтому живёт полями самого материала.
 *
 * Название или адрес без булавки местом не считаются: «где-то в Херизау» — это не
 * «где», а строка. Монеты и способы оплаты без места не сохраняются вовсе — обещание
 * «тут берут биткойн» без адреса относится неизвестно к чему.
 */
function parsePlace(input: AdInput): { ok: true; value: PlaceValues } | { ok: false; reason: string } {
  const name = (input.placeName ?? "").trim();
  const address = (input.placeAddress ?? "").trim();
  const lat = num(input.placeLat);
  const lon = num(input.placeLon);

  if (!name && !address && lat === null && lon === null) return { ok: true, value: EMPTY_PLACE };

  if (lat === null || lon === null) return { ok: false, reason: "place_coords_required" };
  // Та же проверка, что у точки приёма: (0,0) — Нулевой остров, то есть незаполненная
  // форма, а не место в Атлантике.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, reason: "place_coords_invalid" };
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { ok: false, reason: "place_coords_invalid" };
  if (lat === 0 && lon === 0) return { ok: false, reason: "place_coords_invalid" };
  if (name.length > 120 || address.length > 200) return { ok: false, reason: "place_too_long" };
  // Ссылка в названии места — та же дыра, что ссылка в тексте (правило BG).
  if ((name && hasLink(name)) || (address && hasLink(address))) return { ok: false, reason: "text_has_link" };

  return {
    ok: true,
    value: {
      placeName: name || null,
      placeAddress: address || null,
      placeLat: lat,
      placeLon: lon,
      placeAcceptedCoinIds: idList(input.placeAcceptedCoinIds),
      placeAcceptedCardIds: idList(input.placeAcceptedCardIds),
      placePaymentMethods: parsePaymentMethods(input.placePaymentMethods),
    },
  };
}

export function parseAdInput(input: AdInput): AdParse {
  const kind = AD_KINDS.find((k) => k === input.kind);
  if (!kind) return fail("kind_invalid");

  const title = input.title.trim();
  if (!title) return fail("title_required");
  if (title.length > AD_TITLE_MAX) return fail("title_too_long");

  const body = (input.body ?? "").trim();
  if (body.length > AD_BODY_MAX) return fail("body_too_long");
  // Ссылок в тексте нет (правило BG): текст читается голосом, а ссылка в голосе
  // бессмысленна. Переход у материала один и названный — кнопкой.
  if (hasLink(title) || (body && hasLink(body))) return fail("text_has_link");

  const language = SUPPORTED_LOCALES.find((l) => l === input.language);
  if (!language) return fail("language_invalid");

  const mediaKind = input.mediaKind === "VIDEO" ? "VIDEO" : "IMAGE";
  const mediaUrl = (input.mediaUrl ?? "").trim();
  if (!mediaUrl) return fail("media_required");
  if (!isOwnMedia(mediaUrl)) return fail("media_invalid");
  const posterUrl = (input.posterUrl ?? "").trim() || null;
  if (posterUrl && !isOwnMedia(posterUrl)) return fail("media_invalid");
  const audioUrl = (input.audioUrl ?? "").trim() || null;
  if (audioUrl && !isOwnMedia(audioUrl)) return fail("media_invalid");
  const audioGenerated = Boolean(audioUrl && input.audioGenerated);
  const audioVoice = audioGenerated && isAdVoice(input.audioVoice) ? input.audioVoice : null;
  const audioTextHash = audioGenerated
    ? ((input.audioTextHash ?? "").trim().slice(0, 64) || adTextHash(title, body))
    : null;

  const promoCode = (input.promoCode ?? "").trim() || null;
  if (promoCode && promoCode.length > AD_PROMO_CODE_MAX) return fail("promo_code_too_long");

  const startsRaw = (input.startsAt ?? "").trim();
  const endsRaw = (input.endsAt ?? "").trim();
  const startsAt = startsRaw ? parseDay(startsRaw, false) : null;
  const endsAt = endsRaw ? parseDay(endsRaw, true) : null;
  if (startsRaw && !startsAt) return fail("window_invalid");
  if (endsRaw && !endsAt) return fail("window_invalid");
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) return fail("window_backwards");

  const eventRaw = (input.eventAt ?? "").trim();
  const eventAt = eventRaw ? parseDay(eventRaw, false) : null;
  if (eventRaw && !eventAt) return fail("event_invalid");
  // Событие без даты — не событие: «когда» и есть то, ради чего человек смотрит.
  if (kind === "EVENT" && !eventAt) return fail("event_required");

  const eventEndRaw = (input.eventEndAt ?? "").trim();
  const eventEndAt = eventEndRaw ? parseDay(eventEndRaw, true) : null;
  if (eventEndRaw && !eventEndAt) return fail("event_invalid");
  // Конец без начала сроком события не является: «по третье» ничего не говорит.
  if (eventEndAt && !eventAt) return fail("event_required");
  if (eventAt && eventEndAt && eventEndAt.getTime() < eventAt.getTime()) return fail("event_backwards");

  const place = parsePlace(input);
  if (!place.ok) return fail(place.reason);

  const action = AD_ACTIONS.find((a) => a === input.action) ?? "NONE";
  let productId: string | null = null;
  let pointId: string | null = null;
  let actionUrl: string | null = null;
  if (action === "PRODUCT") {
    productId = (input.productId ?? "").trim() || null;
    if (!productId) return fail("product_required");
  } else if (action === "POINT") {
    pointId = (input.pointId ?? "").trim() || null;
    if (!pointId) return fail("point_required");
  } else if (action === "WEBSITE") {
    actionUrl = (input.actionUrl ?? "").trim() || null;
    if (!actionUrl) return fail("url_required");
    if (!/^https:\/\/[^\s]+$/i.test(actionUrl)) return fail("url_invalid");
  }

  return {
    ok: true,
    value: {
      kind, title, body: body || null, language, mediaKind, mediaUrl, posterUrl,
      audioUrl, audioGenerated, audioVoice, audioTextHash,
      promoCode, startsAt, endsAt, eventAt, eventEndAt, ...place.value,
      action, productId, pointId, actionUrl,
    },
  };
}

/**
 * Идёт ли материал сейчас. Окно необязательно: пусто значит «пока опубликован» —
 * у новости и у постоянного предложения срока не бывает.
 */
export function adInWindow(
  ad: { startsAt: Date | null; endsAt: Date | null },
  now: Date,
): boolean {
  if (ad.startsAt && now.getTime() < ad.startsAt.getTime()) return false;
  if (ad.endsAt && now.getTime() > ad.endsAt.getTime()) return false;
  return true;
}

/**
 * Виден ли материал снаружи. Своей модерации и своего надзора у рекламы нет — её
 * гасят те же надзоры, что акцию в BG: предприятие залистовано и не снято, материал
 * опубликован и идёт сейчас.
 */
export function adVisible(
  input: {
    company: { status: string; suspendedAt: Date | null; deletedAt: Date | null };
    ad: { status: string; startsAt: Date | null; endsAt: Date | null };
  },
  now: Date,
): boolean {
  const { company, ad } = input;
  if (company.status !== "APPROVED" || company.suspendedAt || company.deletedAt) return false;
  if (ad.status !== "PUBLISHED") return false;
  return adInWindow(ad, now);
}
