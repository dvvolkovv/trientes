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

/**
 * Slice A1 gate for direct writes to the card itself: only before the card
 * goes public. Once APPROVED, edits must go through the A2 revision pipeline
 * so a moderator sees the diff. Site admins bypass this.
 */
export function canEditCardNow(
  card: CardLike,
  userId: string | null | undefined,
  isSiteAdmin: boolean,
): boolean {
  if (isSiteAdmin) return true;
  if (!userId) return false;
  if (!card.stewardUserId || card.stewardUserId !== userId) return false;
  return card.status === "PENDING" || card.status === "REJECTED";
}
