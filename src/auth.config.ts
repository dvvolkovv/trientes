import type { NextAuthConfig } from "next-auth";

// NOTE: No providers here — providers use node:crypto and cannot run in the
// edge runtime (middleware). Providers are added only in src/auth.ts which
// runs in the Node.js runtime.
export const authConfig = {
  providers: [],
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
