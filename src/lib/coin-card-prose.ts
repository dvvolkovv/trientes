// Какая именно проза есть у карточки монеты и как влить в неё перевод.
// Карточко-специфичная часть держится здесь, чтобы localized-prose.ts остался
// общим для компаний и финтеха, а страница — тонкой.

import { localizedProse } from "@/lib/localized-prose";

type Json = Record<string, unknown>;

function obj(raw: unknown): Json {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Json;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

/**
 * Поля карточки, которые являются прозой. Всё остальное — данные.
 * Примечания юрисдикций приходят индексированными ключами `legalNote:<CC>`:
 * их число и состав зависят от карточки, но перевести их надо так же, как
 * описание — иначе японец читает правовую оговорку по-русски.
 */
export type CardProse = Record<string, string | null> & {
  tagline: string | null;
  description: string | null;
  pitch: string | null;
  emission: string | null;
  burn: string | null;
  feeNote: string | null;
};

export type CardLike = {
  tagline: string | null;
  description: string | null;
  marketing: unknown;
  tokenomics: unknown;
  payments?: unknown;
  legal?: unknown;
};

const LEGAL_NOTE_PREFIX = "legalNote:";

function legalRows(raw: unknown): Array<Record<string, unknown>> {
  const l = obj(raw);
  return Array.isArray(l.jurisdictions)
    ? l.jurisdictions.filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    : [];
}

export function collectCardProse(card: CardLike): CardProse {
  const marketing = obj(card.marketing);
  const tokenomics = obj(card.tokenomics);
  const payments = obj(card.payments);
  const out: CardProse = {
    tagline: str(card.tagline),
    description: str(card.description),
    pitch: str(marketing.pitch),
    emission: str(tokenomics.emission),
    // Исторически встречаются оба имени: форма пишет `burn`, в старых
    // записях попадается `burnMechanism`.
    burn: str(tokenomics.burn) ?? str(tokenomics.burnMechanism),
    feeNote: str(payments.feeNote),
  };
  for (const row of legalRows(card.legal)) {
    const cc = String(row.countryCode ?? "").toUpperCase();
    const note = str(row.note);
    if (cc && note) out[`${LEGAL_NOTE_PREFIX}${cc}`] = note;
  }
  return out;
}

/** Возвращает копию карточки с прозой, заменённой на перевод. */
export function applyCardProse<T extends CardLike>(card: T, prose: CardProse): T {
  const marketing = obj(card.marketing);
  const tokenomics = obj(card.tokenomics);
  const payments = obj(card.payments);
  const rows = legalRows(card.legal);
  const legal = rows.length
    ? {
        ...obj(card.legal),
        jurisdictions: rows.map((row) => {
          const cc = String(row.countryCode ?? "").toUpperCase();
          const t = prose[`${LEGAL_NOTE_PREFIX}${cc}`];
          return t ? { ...row, note: t } : row;
        }),
      }
    : card.legal;
  return {
    ...card,
    tagline: prose.tagline ?? card.tagline,
    description: prose.description ?? card.description,
    marketing: prose.pitch ? { ...marketing, pitch: prose.pitch } : card.marketing,
    tokenomics: prose.emission || prose.burn
      ? {
          ...tokenomics,
          ...(prose.emission ? { emission: prose.emission } : {}),
          ...(prose.burn ? { burn: prose.burn } : {}),
        }
      : card.tokenomics,
    payments: prose.feeNote ? { ...payments, feeNote: prose.feeNote } : card.payments,
    legal,
  };
}

/**
 * Карточка на языке интерфейса. При отказе перевода (нет ключа, таймаут, сбой
 * модели) возвращается исходная карточка и `translated: false` — маркер
 * «машинный перевод» не должен появляться там, где перевода не было.
 */
export async function localizeCoinCard<T extends CardLike & { id: string; sourceLocale: string | null }>(
  card: T,
  locale: string,
  original = false,
): Promise<{ card: T; translated: boolean; sourceLocale: string | null }> {
  const prose = collectCardProse(card);
  const res = await localizedProse({
    ns: "card",
    id: card.id,
    locale,
    sourceLocale: card.sourceLocale,
    fields: prose,
    original,
  });
  if (!res.translated) return { card, translated: false, sourceLocale: res.sourceLocale };
  return {
    card: applyCardProse(card, res.fields),
    translated: true,
    sourceLocale: res.sourceLocale,
  };
}
