import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import { TelegramProvider } from "@/lib/telegram-provider";

export const authConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
    TelegramProvider(),
  ],
  pages: {
    signIn: "/en/login",
  },
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      const isAdminRoute = /\/[a-z-]+\/admin(\/|$)/i.test(path);
      const isProtectedRoute =
        /\/[a-z-]+\/(watchlist|request|settings)(\/|$)/i.test(path);
      const role = (auth?.user as { role?: string } | undefined)?.role;
      if (isAdminRoute) return role === "ADMIN";
      if (isProtectedRoute) return !!auth?.user;
      return true;
    },
  },
} satisfies NextAuthConfig;
