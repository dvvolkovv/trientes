// Shareable invite links for company teams. inviteMember() can only add users
// that already have a Trientes account; a link covers the other case — the
// owner sends it over any channel and the invitee joins after signing up.
// The token lifecycle itself lives in invite-tokens.ts, shared with coin cards.

export {
  INVITE_TTL_DAYS,
  MAX_ACTIVE_INVITES,
  generateInviteToken,
  inviteExpiry,
  inviteState,
  isInviteUsable,
} from "@/lib/invite-tokens";
export type { InviteState, InviteLifecycle } from "@/lib/invite-tokens";

export function buildInviteUrl(origin: string, locale: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/${locale}/invite/${token}`;
}
