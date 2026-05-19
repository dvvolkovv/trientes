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
