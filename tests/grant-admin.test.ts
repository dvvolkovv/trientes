import { describe, expect, it, vi } from "vitest";
import { grantAdminCore } from "@/lib/grant-admin-core";

type FakeDB = {
  users: Array<{ id: string; email: string | null; role: "USER" | "ADMIN" }>;
  accounts: Array<{
    userId: string;
    provider: string;
    providerAccountId: string;
  }>;
};

function fakePrisma(db: FakeDB) {
  return {
    user: {
      findFirst: vi.fn(async ({ where }: { where: unknown }) => {
        const w = where as { email?: string; id?: string };
        if (w.email)
          return db.users.find((u) => u.email?.toLowerCase() === w.email?.toLowerCase()) ?? null;
        if (w.id) return db.users.find((u) => u.id === w.id) ?? null;
        return null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { role: "ADMIN" } }) => {
        const u = db.users.find((u) => u.id === where.id);
        if (!u) throw new Error("not found");
        u.role = data.role;
        return u;
      }),
    },
    account: {
      findFirst: vi.fn(async ({ where }: { where: { provider: string; providerAccountId: string } }) => {
        return (
          db.accounts.find(
            (a) =>
              a.provider === where.provider &&
              a.providerAccountId === where.providerAccountId,
          ) ?? null
        );
      }),
    },
  };
}

describe("grantAdminCore", () => {
  it("promotes by email", async () => {
    const db: FakeDB = {
      users: [{ id: "u1", email: "foo@bar.com", role: "USER" }],
      accounts: [],
    };
    const result = await grantAdminCore(fakePrisma(db) as never, {
      email: "foo@bar.com",
    });
    expect(result).toEqual({ ok: true, userId: "u1" });
    expect(db.users[0].role).toBe("ADMIN");
  });

  it("promotes by github id (via accounts)", async () => {
    const db: FakeDB = {
      users: [{ id: "u2", email: null, role: "USER" }],
      accounts: [
        { userId: "u2", provider: "github", providerAccountId: "98765" },
      ],
    };
    const result = await grantAdminCore(fakePrisma(db) as never, {
      github: "98765",
    });
    expect(result).toEqual({ ok: true, userId: "u2" });
    expect(db.users[0].role).toBe("ADMIN");
  });

  it("promotes by telegram id (via accounts)", async () => {
    const db: FakeDB = {
      users: [{ id: "u3", email: null, role: "USER" }],
      accounts: [
        { userId: "u3", provider: "telegram", providerAccountId: "42" },
      ],
    };
    const result = await grantAdminCore(fakePrisma(db) as never, {
      telegram: "42",
    });
    expect(result).toEqual({ ok: true, userId: "u3" });
    expect(db.users[0].role).toBe("ADMIN");
  });

  it("returns not_found when no match", async () => {
    const db: FakeDB = { users: [], accounts: [] };
    const result = await grantAdminCore(fakePrisma(db) as never, {
      email: "missing@x.com",
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("requires at least one identifier", async () => {
    const db: FakeDB = { users: [], accounts: [] };
    const result = await grantAdminCore(fakePrisma(db) as never, {});
    expect(result).toEqual({ ok: false, reason: "no_identifier" });
  });
});
