import type { CardSection } from "@/lib/coin-card-risk";

export type CardRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

export type MemberLike = {
  role: CardRole;
  sections: readonly CardSection[];
};

/**
 * Section-level write permission. OWNER/ADMIN are unrestricted; EDITOR is
 * limited to the sections granted to them; VIEWER is read-only.
 */
export function canEditSection(
  member: MemberLike | null | undefined,
  section: CardSection,
): boolean {
  if (!member) return false;
  if (member.role === "OWNER" || member.role === "ADMIN") return true;
  if (member.role === "EDITOR") return member.sections.includes(section);
  return false;
}

/** ADMIN may invite EDITOR/VIEWER but never touch an OWNER — enforced by the caller. */
export function canManageMembers(member: MemberLike | null | undefined): boolean {
  return member?.role === "OWNER" || member?.role === "ADMIN";
}

/** Changing the multisig policy is an OWNER-only act. */
export function canManagePolicy(member: MemberLike | null | undefined): boolean {
  return member?.role === "OWNER";
}

export type CardLike = {
  status: "PENDING" | "APPROVED" | "REJECTED";
  stewardUserId: string | null;
};

export type SignerLike = MemberLike & { isSigner: boolean };

/** Only a signer votes. Role is irrelevant — a VIEWER lawyer can be a signer. */
export function canVote(member: SignerLike | null | undefined): boolean {
  return Boolean(member?.isSigner);
}

/**
 * An ADMIN runs the team but may neither create, change nor remove an OWNER —
 * otherwise "admin" is a silent path to taking the card over.
 */
export function canAssignRole(
  actor: MemberLike | null | undefined,
  targetRole: CardRole,
): boolean {
  if (!actor) return false;
  if (actor.role === "OWNER") return true;
  if (actor.role === "ADMIN") return targetRole !== "OWNER";
  return false;
}

/**
 * Direct writes to the card are allowed only before it goes public. Once
 * APPROVED, every change must become a reviewable revision — that is the whole
 * point of the pipeline. Site admins bypass it (they are the review).
 */
export function canEditCardDirectly(
  card: CardLike,
  member: MemberLike | null | undefined,
  section: CardSection,
  isSiteAdmin: boolean,
): boolean {
  if (isSiteAdmin) return true;
  if (card.status === "APPROVED") return false;
  return canEditSection(member, section);
}
