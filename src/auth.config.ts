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
      const locale = path.split("/")[1] || "en";
      const isAdminRoute = /\/[a-z-]+\/admin(\/|$)/i.test(path);
      const isProtectedRoute =
        /\/[a-z-]+\/(watchlist|request|settings)(\/|$)/i.test(path);
      const role = (auth?.user as { role?: string } | undefined)?.role;
      if (isAdminRoute && role !== "ADMIN") {
        return Response.redirect(
          new URL(`/${locale}/login`, request.nextUrl),
        );
      }
      if (isProtectedRoute && !auth?.user) {
        return Response.redirect(
          new URL(`/${locale}/login`, request.nextUrl),
        );
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
