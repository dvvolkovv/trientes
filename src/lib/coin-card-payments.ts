// Платёжный профиль карточки (слайс F2): что продавец должен знать, прежде чем
// принимать монету. Раздел высокорисковый — завышенная скорость или заниженная
// комиссия это решение продавца, принятое на ложных данных, поэтому валидация
// строгая и чистая.
//
// Провенанс закладывается здесь: в F2 поля заполняет проект с меткой
// SELF_REPORTED, а воркер слайса B позже перезапишет их как VERIFIED_ONCHAIN.
// mergeProvenance уже гарантирует, что самозаявление не затрёт проверенное.

import { normalizeHttpUrl } from "@/lib/coin-card-validate";

export const MAX_INTEGRATIONS = 20;
export const MAX_FEE_NOTE = 200;

export const PAYMENT_INTEGRATION_KINDS = [
  "WOOCOMMERCE",
  "SHOPIFY",
  "1C",
  "POS",
  "SDK",
  "OTHER",
] as const;
export type PaymentIntegrationKind = (typeof PAYMENT_INTEGRATION_KINDS)[number];

export type PaymentIntegration = {
  kind: PaymentIntegrationKind;
  name: string;
  url: string | null;
};

export type Payments = {
  /** Когда платёж неотзывен, секунды. */
  finalitySeconds: number | null;
  blockSeconds: number | null;
  /** Заявленная пропускная способность, транзакций в секунду. */
  tps: number | null;
  /** Типичная комиссия перевода в USD. Ноль допустим: бывают сети без комиссии. */
  feeUsdTypical: number | null;
  feeNote: string | null;
  /** Есть ли возврат или чарджбэк на уровне сети. */
  reversible: boolean | null;
  stablecoins: string[];
  integrations: PaymentIntegration[];
  refundPolicyUrl: string | null;
};

export type PaymentsResult =
  | { ok: true; data: Payments }
  | {
      ok: false;
      reason:
        | "finality_invalid"
        | "tps_invalid"
        | "fee_invalid"
        | "fee_note_too_long"
        | "integration_incomplete"
        | "integration_url_invalid"
        | "too_many_integrations";
    };

function asObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

/** null/"" → не задано; иначе должно быть конечным числом. */
function num(v: unknown): number | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : "invalid";
}

function bool(v: unknown): boolean | null {
  if (v === null || v === undefined || v === "") return null;
  return Boolean(v);
}

export function validatePayments(raw: unknown): PaymentsResult {
  const p = asObject(raw);

  const finality = num(p.finalitySeconds);
  const block = num(p.blockSeconds);
  // Ноль секунд финальности означал бы «подтверждено до отправки» — это не
  // оптимизм, это неверные данные.
  if (finality === "invalid" || (finality !== null && finality <= 0)) {
    return { ok: false, reason: "finality_invalid" };
  }
  if (block === "invalid" || (block !== null && block <= 0)) {
    return { ok: false, reason: "finality_invalid" };
  }

  const tps = num(p.tps);
  if (tps === "invalid" || (tps !== null && tps <= 0)) return { ok: false, reason: "tps_invalid" };

  const fee = num(p.feeUsdTypical);
  if (fee === "invalid" || (fee !== null && fee < 0)) return { ok: false, reason: "fee_invalid" };

  const feeNote = typeof p.feeNote === "string" && p.feeNote.trim() ? p.feeNote.trim() : null;
  if (feeNote && feeNote.length > MAX_FEE_NOTE) return { ok: false, reason: "fee_note_too_long" };

  const stablecoins = Array.isArray(p.stablecoins)
    ? Array.from(
        new Set(
          p.stablecoins
            .map((s) => String(s).trim().toUpperCase())
            .filter(Boolean),
        ),
      )
    : [];

  const rawIntegrations = Array.isArray(p.integrations) ? p.integrations : [];
  if (rawIntegrations.length > MAX_INTEGRATIONS) {
    return { ok: false, reason: "too_many_integrations" };
  }
  const integrations: PaymentIntegration[] = [];
  for (const item of rawIntegrations) {
    const row = asObject(item);
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) return { ok: false, reason: "integration_incomplete" };
    const url = normalizeHttpUrl(row.url as string | null | undefined);
    if (url === "invalid") return { ok: false, reason: "integration_url_invalid" };
    // Незнакомый вид не выбрасываем: «другое» честнее, чем пропавшая строка.
    const kindRaw = String(row.kind ?? "").toUpperCase();
    const kind = (PAYMENT_INTEGRATION_KINDS as readonly string[]).includes(kindRaw)
      ? (kindRaw as PaymentIntegrationKind)
      : "OTHER";
    integrations.push({ kind, name, url });
  }

  const refundPolicyUrl = normalizeHttpUrl(p.refundPolicyUrl as string | null | undefined);
  if (refundPolicyUrl === "invalid") return { ok: false, reason: "integration_url_invalid" };

  return {
    ok: true,
    data: {
      finalitySeconds: finality,
      blockSeconds: block,
      tps,
      feeUsdTypical: fee,
      feeNote,
      reversible: bool(p.reversible),
      stablecoins,
      integrations,
      refundPolicyUrl,
    },
  };
}
