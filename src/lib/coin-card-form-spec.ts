// Declarative description of the editable fields of every card section. One
// spec, one renderer (components/coin-card-manage/section-editor.tsx) — the
// alternative was eight near-identical forms.
//
// `label` is an i18n key under coinCard.wizard, so the labels the wizard
// already ships are reused verbatim.

import type { CardSection } from "@/lib/coin-card-risk";
import { SUPPORTED_CHAINS } from "@/lib/coin-card-validate";

export type FieldSpec =
  | { kind: "text" | "url" | "textarea" | "date"; path: string; label: string }
  | { kind: "logo"; path: string; label: string }
  | { kind: "number"; path: string; label: string }
  | { kind: "bool"; path: string; label: string }
  | { kind: "lines"; path: string; label: string }
  | { kind: "tags"; path: string; label: string }
  | { kind: "select"; path: string; label: string; options: readonly string[] }
  | { kind: "rows"; path: string; label: string; fields: FieldSpec[] };

export type FormState = Record<string, unknown>;

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let cur = obj;
  for (const key of keys.slice(0, -1)) {
    if (!cur[key] || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

const ROW_SUBFIELDS: Record<string, FieldSpec[]> = {
  contract: [
    { kind: "select", path: "chain", label: "chain", options: SUPPORTED_CHAINS },
    { kind: "text", path: "address", label: "address" },
    { kind: "number", path: "decimals", label: "decimals" },
    { kind: "text", path: "standard", label: "standard" },
    { kind: "url", path: "explorerUrl", label: "explorerUrl" },
    { kind: "bool", path: "isCanonical", label: "isCanonical" },
  ],
  market: [
    { kind: "select", path: "kind", label: "marketKind", options: ["CEX", "DEX"] },
    { kind: "text", path: "exchangeName", label: "exchangeName" },
    { kind: "text", path: "pair", label: "pair" },
    { kind: "url", path: "tradeUrl", label: "tradeUrl" },
    { kind: "text", path: "chain", label: "chain" },
    { kind: "text", path: "poolAddress", label: "poolAddress" },
  ],
  jurisdiction: [
    { kind: "text", path: "countryCode", label: "jurisdictionCountry" },
    { kind: "select", path: "status", label: "jurisdictionStatus",
      options: ["ALLOWED", "LICENSED", "RESTRICTED", "BANNED", "UNCLEAR"] },
    { kind: "text", path: "note", label: "jurisdictionNote" },
    { kind: "url", path: "sourceUrl", label: "jurisdictionSource" },
    { kind: "date", path: "asOf", label: "jurisdictionAsOf" },
  ],
  integration: [
    { kind: "select", path: "kind", label: "integrationKind",
      options: ["WOOCOMMERCE", "SHOPIFY", "1C", "POS", "SDK", "OTHER"] },
    { kind: "text", path: "name", label: "integrationName" },
    { kind: "url", path: "url", label: "integrationUrl" },
  ],
  audit: [
    { kind: "text", path: "firm", label: "auditFirm" },
    { kind: "date", path: "date", label: "auditDate" },
    { kind: "url", path: "reportUrl", label: "auditReport" },
    { kind: "text", path: "scope", label: "auditScope" },
  ],
  member: [
    { kind: "text", path: "name", label: "memberName" },
    { kind: "text", path: "role", label: "memberRole" },
    { kind: "url", path: "link", label: "memberLink" },
  ],
  milestone: [
    { kind: "text", path: "title", label: "milestoneTitle" },
    { kind: "text", path: "date", label: "milestoneDate" },
    { kind: "text", path: "status", label: "milestoneStatus" },
  ],
};

export const SECTION_SPECS: Record<CardSection, FieldSpec[]> = {
  IDENTITY: [
    { kind: "text", path: "name", label: "name" },
    { kind: "text", path: "symbol", label: "symbol" },
    { kind: "text", path: "tagline", label: "tagline" },
    { kind: "textarea", path: "description", label: "description" },
    { kind: "logo", path: "logoUrl", label: "logo" },
    { kind: "date", path: "launchDate", label: "launchDate" },
    { kind: "tags", path: "tags", label: "tags" },
    { kind: "text", path: "sourceLocale", label: "sourceLocale" },
  ],
  CONTRACTS: [
    { kind: "rows", path: "contracts", label: "contract", fields: ROW_SUBFIELDS.contract },
  ],
  TOKENOMICS: [
    { kind: "number", path: "tokenomics.circulating", label: "circulating" },
    { kind: "number", path: "tokenomics.total", label: "totalSupply" },
    { kind: "number", path: "tokenomics.max", label: "maxSupply" },
    { kind: "lines", path: "tokenomics.excludedAddresses", label: "excludedAddresses" },
    { kind: "text", path: "tokenomics.emission", label: "emission" },
    { kind: "text", path: "tokenomics.burn", label: "burnMechanism" },
  ],
  MARKETS: [{ kind: "rows", path: "markets", label: "market", fields: ROW_SUBFIELDS.market }],
  SECURITY: [
    { kind: "rows", path: "security.audits", label: "audit", fields: ROW_SUBFIELDS.audit },
    { kind: "text", path: "security.legalEntity", label: "legalEntity" },
    { kind: "text", path: "security.jurisdiction", label: "jurisdiction" },
    { kind: "bool", path: "security.teamDoxxed", label: "teamDoxxed" },
    { kind: "bool", path: "security.riskFlags.mintable", label: "flagMintable" },
    { kind: "bool", path: "security.riskFlags.pausable", label: "flagPausable" },
    { kind: "bool", path: "security.riskFlags.blacklist", label: "flagBlacklist" },
    { kind: "bool", path: "security.riskFlags.transferTax", label: "flagTransferTax" },
    { kind: "bool", path: "security.riskFlags.upgradeableProxy", label: "flagProxy" },
    { kind: "bool", path: "security.riskFlags.lpLocked", label: "flagLpLocked" },
  ],
  TEAM: [
    { kind: "rows", path: "teamInfo.members", label: "member", fields: ROW_SUBFIELDS.member },
    { kind: "lines", path: "teamInfo.investors", label: "investors" },
    { kind: "lines", path: "teamInfo.partners", label: "partners" },
  ],
  LINKS: [
    { kind: "url", path: "links.website", label: "website" },
    { kind: "url", path: "links.explorer", label: "links.explorer" },
    { kind: "url", path: "links.docs", label: "links.docs" },
    { kind: "url", path: "links.whitepaper", label: "links.whitepaper" },
    { kind: "url", path: "links.github", label: "links.github" },
    { kind: "url", path: "links.x", label: "links.x" },
    { kind: "url", path: "links.telegram", label: "links.telegram" },
    { kind: "url", path: "links.discord", label: "links.discord" },
    { kind: "url", path: "links.reddit", label: "links.reddit" },
    { kind: "url", path: "links.blog", label: "links.blog" },
    { kind: "url", path: "links.youtube", label: "links.youtube" },
  ],
  MARKETING: [
    { kind: "textarea", path: "marketing.pitch", label: "pitch" },
    { kind: "rows", path: "marketing.roadmap", label: "milestone", fields: ROW_SUBFIELDS.milestone },
    { kind: "url", path: "marketing.mediaKit", label: "mediaKit" },
    { kind: "url", path: "marketing.videoUrl", label: "videoUrl" },
  ],
  ACCEPTANCE: [],
  LEGAL: [
    { kind: "rows", path: "legal.jurisdictions", label: "jurisdiction", fields: ROW_SUBFIELDS.jurisdiction },
  ],
  PAYMENTS: [
    { kind: "number", path: "payments.finalitySeconds", label: "finalitySeconds" },
    { kind: "number", path: "payments.blockSeconds", label: "blockSeconds" },
    { kind: "number", path: "payments.tps", label: "tps" },
    { kind: "number", path: "payments.feeUsdTypical", label: "feeUsdTypical" },
    { kind: "text", path: "payments.feeNote", label: "feeNote" },
    { kind: "bool", path: "payments.reversible", label: "reversible" },
    { kind: "lines", path: "payments.stablecoins", label: "stablecoins" },
    { kind: "rows", path: "payments.integrations", label: "integration", fields: ROW_SUBFIELDS.integration },
    { kind: "url", path: "payments.refundPolicyUrl", label: "refundPolicyUrl" },
  ],
};

/** Sections a team can actually edit today. ACCEPTANCE остаётся вне списка:
 *  он агрегируется из базы точек, а не вводится командой. */
export const EDITABLE_SECTIONS: CardSection[] = [
  "IDENTITY", "CONTRACTS", "TOKENOMICS", "MARKETS",
  "SECURITY", "TEAM", "LINKS", "MARKETING", "PAYMENTS", "LEGAL",
];

function scalarToInput(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  return String(v);
}

/**
 * Flat form state keyed by field path. Row groups hold an array of plain row
 * objects whose values are already input-shaped strings.
 */
export function specToInitial(spec: readonly FieldSpec[], card: unknown): FormState {
  const state: FormState = {};
  for (const f of spec) {
    const raw = getPath(card, f.path);
    if (f.kind === "rows") {
      const rows = Array.isArray(raw) ? raw : [];
      state[f.path] = rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const sub of f.fields) {
          const v = getPath(row, sub.path);
          out[sub.path] = sub.kind === "bool" ? Boolean(v) : scalarToInput(v);
        }
        return out;
      });
    } else if (f.kind === "bool") {
      state[f.path] = Boolean(raw);
    } else if (f.kind === "lines") {
      state[f.path] = Array.isArray(raw) ? raw.join("\n") : scalarToInput(raw);
    } else if (f.kind === "tags") {
      state[f.path] = Array.isArray(raw) ? raw.join(", ") : scalarToInput(raw);
    } else {
      state[f.path] = scalarToInput(raw);
    }
  }
  return state;
}

function parseScalar(kind: FieldSpec["kind"], v: unknown): unknown {
  if (kind === "bool") return Boolean(v);
  if (kind === "number") {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

/** Form state → the payload shape `normalizeSectionPayload` expects. */
export function stateToPayload(
  spec: readonly FieldSpec[],
  state: FormState,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of spec) {
    const raw = state[f.path];
    if (f.kind === "rows") {
      const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
      const out = rows
        .map((row) => {
          const o: Record<string, unknown> = {};
          for (const sub of f.fields) o[sub.path] = parseScalar(sub.kind, row[sub.path]);
          return o;
        })
        // A row the user added and never filled is not data. A dropdown's
        // default and an unchecked box don't count as filling it in.
        .filter((o) =>
          f.fields.some(
            (sub) =>
              sub.kind !== "select" && sub.kind !== "bool" && o[sub.path] !== null,
          ),
        );
      setPath(payload, f.path, out);
    } else if (f.kind === "lines") {
      setPath(
        payload,
        f.path,
        String(raw ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
      );
    } else if (f.kind === "tags") {
      setPath(
        payload,
        f.path,
        String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      );
    } else {
      setPath(payload, f.path, parseScalar(f.kind, raw));
    }
  }
  return payload;
}
