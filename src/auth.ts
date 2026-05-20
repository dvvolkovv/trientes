import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import {
  isAdminWhitelisted,
  parseAdminWhitelist,
} from "@/lib/admin-whitelist";
import { authConfig } from "@/auth.config";

const adminWhitelist = parseAdminWhitelist(process.env.ADMIN_WHITELIST);

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // We're behind nginx/SSL on trientes.org — Host header is trusted.
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  events: {
    // Fires AFTER the User row is created by PrismaAdapter — safe to update.
    async createUser({ user }) {
      const matched = isAdminWhitelisted(adminWhitelist, {
        email: user.email ?? null,
      });
      if (matched && user.id) {
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { role: "ADMIN" },
          });
        } catch (err) {
          console.error("[auth] createUser ADMIN-promotion failed:", err);
        }
      }
    },
    // Fires AFTER an Account row is linked. Catches the github (login) and
    // telegram (providerAccountId) paths that aren't available on createUser.
    async linkAccount({ user, account, profile }) {
      if (!user?.id) return;
      const githubLogin =
        account?.provider === "github"
          ? ((profile as { login?: string } | undefined)?.login ?? null)
          : null;
      const telegramId =
        account?.provider === "telegram"
          ? (account.providerAccountId ?? null)
          : null;
      const matched = isAdminWhitelisted(adminWhitelist, {
        email: user.email ?? null,
        telegramId,
        githubLogin,
      });
      if (matched) {
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { role: "ADMIN" },
          });
        } catch (err) {
          console.error("[auth] linkAccount ADMIN-promotion failed:", err);
        }
      }
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    // No DB writes in signIn — at this point the User row may not exist yet on
    // first OAuth sign-in. Admin promotion happens in events.createUser /
    // events.linkAccount, which fire after the adapter has done its work.
    async signIn() {
      return true;
    },
    async session({ session, user }) {
      if (session.user) {
        (session.user as { id?: string }).id = user.id;
        (session.user as { role?: string }).role = (user as { role?: string })
          .role;
      }
      return session;
    },
  },
});
