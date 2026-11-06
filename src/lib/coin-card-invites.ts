// Invite links for coin card teams. The token lifecycle is shared with company
// invites (src/lib/invite-tokens.ts); only the URL shape and the carried
// permissions differ — a card invite also carries sections and the signer flag.

export {
  INVITE_TTL_DAYS,
  MAX_ACTIVE_INVITES,
  generateInviteToken,
  inviteExpiry,
  inviteState,
  isInviteUsable,
} from "@/lib/invite-tokens";
export type { InviteState, InviteLifecycle } from "@/lib/invite-tokens";

export function buildCardInviteUrl(origin: string, locale: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/${locale}/invite/coin/${token}`;
}
