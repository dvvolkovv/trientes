import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type SessionCookie = {
  name: string;
  value: string;
  expires: Date;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
};

export function authSessionCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}

// Creates a Session row for the given user and returns the cookie attributes
// the caller should set on the NextResponse.
export async function createDatabaseSession(userId: string): Promise<SessionCookie> {
  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { sessionToken, userId, expires } });
  return {
    name: authSessionCookieName(),
    value: sessionToken,
    expires,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}
