// Shareable invite links for company teams. inviteMember() can only add users
// that already have a Trientes account; a link covers the other case — the
// owner sends it over any channel and the invitee joins after signing up.

import { randomBytes } from "node:crypto";

export const INVITE_TTL_DAYS = 14;
// Same ceiling as pending points: enough for a real team, low enough that a
// compromised owner session cannot mint links forever.
export const MAX_ACTIVE_INVITES = 20;

export type InviteState = "valid" | "expired" | "accepted" | "revoked";

export type InviteLifecycle = {
  expiresAt: Date;
  acceptedAt?: Date | null;
  revokedAt?: Date | null;
};

export function generateInviteToken(): string {
  // 24 random bytes → 32 base64url chars, URL-safe without escaping.
  return randomBytes(24).toString("base64url");
}

export function inviteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// Revoked beats accepted beats expired: the strongest reason a link is dead is
// the one worth showing.
export function inviteState(invite: InviteLifecycle, now: Date = new Date()): InviteState {
  if (invite.revokedAt) return "revoked";
  if (invite.acceptedAt) return "accepted";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

export function isInviteUsable(invite: InviteLifecycle, now: Date = new Date()): boolean {
  return inviteState(invite, now) === "valid";
}

export function buildInviteUrl(origin: string, locale: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/${locale}/invite/${token}`;
}
