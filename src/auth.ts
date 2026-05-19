import NextAuth from "next-auth";
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
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  events: {
    async createUser({ user }) {
      const matched = isAdminWhitelisted(adminWhitelist, {
        email: user.email ?? null,
      });
      if (matched && user.id) {
        await prisma.user.update({
          where: { id: user.id },
          data: { role: "ADMIN" },
        });
      }
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (!user?.id) return true;
      const githubLogin =
        account?.provider === "github"
          ? ((profile as { login?: string } | undefined)?.login ?? null)
          : null;
      const telegramId =
        account?.provider === "telegram" ? (account.providerAccountId ?? null) : null;
      const matched = isAdminWhitelisted(adminWhitelist, {
        email: user.email ?? null,
        telegramId,
        githubLogin,
      });
      if (matched) {
        await prisma.user.update({
          where: { id: user.id },
          data: { role: "ADMIN" },
        });
      }
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
