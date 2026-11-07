export type CardSection =
  | "IDENTITY" | "CONTRACTS" | "TOKENOMICS" | "MARKETS"
  | "SECURITY" | "TEAM" | "LINKS" | "MARKETING" | "ACCEPTANCE" | "PAYMENTS" | "LEGAL";

/** Sections where a bad edit can defraud users (wrong contract, fake supply). */
// PAYMENTS (слайс F2) здесь не случайно: завышенная скорость или заниженная
// комиссия — это решение продавца, принятое на ложных данных.
export const HIGH_RISK_SECTIONS: readonly CardSection[] = [
  "CONTRACTS", "TOKENOMICS", "MARKETS", "SECURITY", "PAYMENTS", "LEGAL",
];

/** Low-risk sections — still moderated while the card is UNVERIFIED. */
export const LOW_RISK_SECTIONS: readonly CardSection[] = [
  "IDENTITY", "TEAM", "LINKS", "MARKETING", "ACCEPTANCE",
];

/** Root field paths that belong to IDENTITY but carry identity-theft risk. */
const HIGH_RISK_IDENTITY_PATHS = new Set(["symbol", "slug", "coinId"]);

/** Root field paths of IDENTITY that are safe to publish without review. */
const LOW_RISK_IDENTITY_PATHS = new Set([
  "name", "tagline", "description", "logoUrl",
  "launchDate", "tags", "consensus", "hashAlgo",
]);

const SECTION_BY_ROOT: Record<string, CardSection> = {
  contracts: "CONTRACTS",
  // Нативная сеть монеты: подмена значения переносит на карточку выпуск и
  // скорость чужой сети — тот же вектор, что подмена адреса контракта.
  nativeChain: "CONTRACTS",
  tokenomics: "TOKENOMICS",
  markets: "MARKETS",
  security: "SECURITY",
  teamInfo: "TEAM",
  links: "LINKS",
  marketing: "MARKETING",
  acceptance: "ACCEPTANCE",
  payments: "PAYMENTS",
  legal: "LEGAL",
};

export function isHighRiskSection(section: CardSection): boolean {
  return HIGH_RISK_SECTIONS.includes(section);
}

/**
 * Risk of a single dotted field path ("tokenomics.circulating",
 * "contracts.0.address"). Unknown paths return true: a field nobody
 * classified must not slip past the moderator.
 */
export function isHighRiskPath(path: string): boolean {
  const root = (path ?? "").split(".")[0];
  if (HIGH_RISK_IDENTITY_PATHS.has(root)) return true;
  if (LOW_RISK_IDENTITY_PATHS.has(root)) return false;
  const section = SECTION_BY_ROOT[root];
  if (!section) return true;
  return isHighRiskSection(section);
}

/** True when any path in the diff needs a moderator. */
export function diffNeedsModerator(paths: readonly string[]): boolean {
  return paths.some(isHighRiskPath);
}
