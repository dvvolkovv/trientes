import type { NextAuthConfig } from "next-auth";

// NOTE: No providers here — providers use node:crypto and cannot run in the
// edge runtime (middleware). Providers are added only in src/auth.ts which
// runs in the Node.js runtime.
export const authConfig = {
  providers: [],
  // Trust the host header — we run behind nginx/SSL on trientes.org.
  trustHost: true,
  pages: {
    signIn: "/en/login",
  },
  callbacks: {
    // Middleware runs in the edge runtime — it CAN see the session cookie
    // (so it knows whether the user is logged in) but CANNOT query the DB.
    // That means it can't see the user's role. So we only gate logged-in
    // status here. ADMIN role is enforced in src/app/[locale]/admin/layout.tsx
    // via checkAdmin() at the Node.js runtime.
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      const locale = path.split("/")[1] || "en";
      const needsAuth =
        /\/[a-z-]+\/(watchlist|request|settings|admin)(\/|$)/i.test(path);
      if (needsAuth && !auth?.user) {
        return Response.redirect(
          new URL(`/${locale}/login`, request.nextUrl),
        );
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
