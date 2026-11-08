import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { NextRequest } from "next/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const TEST_ORIGIN = "https://auth.test";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const authDb = vi.hoisted(() => {
  const state = {
    users: [] as Array<Record<string, any>>,
    accounts: [] as Array<Record<string, any>>,
    sessions: [] as Array<Record<string, any>>,
    nextUserId: 0,
    nextAccountId: 0,
    nextSessionId: 0,
  };

  const prisma = {
    user: {
      create: vi.fn(async ({ data }: any) => {
        const user = {
          id: `user-${++state.nextUserId}`,
          role: "USER",
          ...data,
        };
        state.users.push(user);
        return user;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id) {
          return state.users.find((user) => user.id === where.id) ?? null;
        }
        if (where.email) {
          return (
            state.users.find((user) => user.email === where.email) ?? null
          );
        }
        if (where.username) {
          return (
            state.users.find((user) => user.username === where.username) ??
            null
          );
        }
        return null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const user = state.users.find((entry) => entry.id === where.id);
        if (!user) throw new Error("test_user_not_found");
        Object.assign(user, data);
        return user;
      }),
      delete: vi.fn(async ({ where }: any) => {
        const index = state.users.findIndex((entry) => entry.id === where.id);
        if (index < 0) throw new Error("test_user_not_found");
        return state.users.splice(index, 1)[0];
      }),
    },
    account: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        const key = where.provider_providerAccountId;
        const account =
          state.accounts.find(
            (entry) =>
              entry.provider === key.provider &&
              entry.providerAccountId === key.providerAccountId,
          ) ?? null;
        if (!account) return null;
        if (!include?.user) return account;
        return {
          ...account,
          user: state.users.find((user) => user.id === account.userId) ?? null,
        };
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          state.accounts.find(
            (entry) =>
              entry.provider === where.provider &&
              entry.providerAccountId === where.providerAccountId,
          ) ?? null
        );
      }),
      create: vi.fn(async ({ data }: any) => {
        const account = { id: `account-${++state.nextAccountId}`, ...data };
        state.accounts.push(account);
        return account;
      }),
      delete: vi.fn(async ({ where }: any) => {
        const key = where.provider_providerAccountId;
        const index = state.accounts.findIndex(
          (entry) =>
            entry.provider === key.provider &&
            entry.providerAccountId === key.providerAccountId,
        );
        if (index < 0) throw new Error("test_account_not_found");
        return state.accounts.splice(index, 1)[0];
      }),
    },
    session: {
      create: vi.fn(async ({ data }: any) => {
        const session = { id: `session-${++state.nextSessionId}`, ...data };
        state.sessions.push(session);
        return session;
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const session =
          state.sessions.find(
            (entry) => entry.sessionToken === where.sessionToken,
          ) ?? null;
        if (!session) return null;
        if (!include?.user) return session;
        return {
          ...session,
          user: state.users.find((user) => user.id === session.userId) ?? null,
        };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const session = state.sessions.find(
          (entry) => entry.sessionToken === where.sessionToken,
        );
        if (!session) throw new Error("test_session_not_found");
        Object.assign(session, data);
        return session;
      }),
      delete: vi.fn(async ({ where }: any) => {
        const index = state.sessions.findIndex(
          (entry) => entry.sessionToken === where.sessionToken,
        );
        if (index < 0) throw new Error("test_session_not_found");
        return state.sessions.splice(index, 1)[0];
      }),
    },
    verificationToken: {
      create: vi.fn(),
      delete: vi.fn(),
    },
    authenticator: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };

  function reset() {
    state.users.length = 0;
    state.accounts.length = 0;
    state.sessions.length = 0;
    state.nextUserId = 0;
    state.nextAccountId = 0;
    state.nextSessionId = 0;
  }

  return { prisma, state, reset };
});

vi.mock("@/lib/prisma", () => ({ prisma: authDb.prisma }));

function requestHeaders(cookie?: string): Headers {
  return new Headers({
    host: "auth.test",
    "x-forwarded-proto": "https",
    ...(cookie ? { cookie } : {}),
  });
}

async function importApplicationAuth() {
  vi.resetModules();
  return import("@/auth");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return String(input);
}

function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

async function beginOAuth(
  handlers: {
    GET: (request: NextRequest) => Promise<Response>;
    POST: (request: NextRequest) => Promise<Response>;
  },
  provider: "google" | "github",
): Promise<{ cookie: string }> {
  const csrfResponse = await handlers.GET(
    new NextRequest(`${TEST_ORIGIN}/api/auth/csrf`, {
      headers: requestHeaders(),
    }),
  );
  expect(csrfResponse.status).toBe(200);
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
  expect(csrfToken).toBeTruthy();
  const csrfCookie = cookieHeader(csrfResponse);

  const headers = requestHeaders(csrfCookie);
  headers.set("content-type", "application/x-www-form-urlencoded");
  const response = await handlers.POST(
    new NextRequest(`${TEST_ORIGIN}/api/auth/signin/${provider}`, {
      method: "POST",
      headers,
      body: new URLSearchParams({ csrfToken, callbackUrl: "/" }).toString(),
    }),
  );
  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  expect(location).toBeTruthy();
  const authorizationUrl = new URL(location!);
  expect(authorizationUrl.origin).toBe(
    provider === "google" ? "https://accounts.google.com" : "https://github.com",
  );
  const codeChallenge = authorizationUrl.searchParams.get("code_challenge");
  expect(codeChallenge).toBeTruthy();
  expect(cookieHeader(response)).toContain("authjs.pkce.code_verifier=");
  return { cookie: cookieHeader(response) };
}

function expectDatabaseOAuthSession(
  provider: "google" | "github",
  providerAccountId: string,
  email: string,
  response: Response,
) {
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(`${TEST_ORIGIN}/`);
  expect(authDb.state.users).toHaveLength(1);
  expect(authDb.state.accounts).toHaveLength(1);
  expect(authDb.state.sessions).toHaveLength(1);

  const user = authDb.state.users[0];
  const account = authDb.state.accounts[0];
  const session = authDb.state.sessions[0];
  expect(user.email).toBe(email);
  expect(account).toMatchObject({
    provider,
    providerAccountId,
    userId: user.id,
  });
  expect(session.userId).toBe(user.id);
  expect(session.expires).toBeInstanceOf(Date);
  expect(session.expires.getTime() - Date.now()).toBeGreaterThan(
    THIRTY_DAYS_MS - 60_000,
  );
  expect(session.expires.getTime() - Date.now()).toBeLessThanOrEqual(
    THIRTY_DAYS_MS,
  );

  const sessionCookie = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("__Secure-authjs.session-token="));
  expect(sessionCookie).toBeTruthy();
  expect(sessionCookie).toContain(
    `__Secure-authjs.session-token=${session.sessionToken}`,
  );
  expect(sessionCookie).toContain("HttpOnly");
  expect(sessionCookie).toContain("SameSite=Lax");
  expect(sessionCookie).toContain("Secure");
  expect(sessionCookie).toContain("Path=/");
  expect(sessionCookie).toContain("Expires=");
}

describe.sequential("NextAuth security regressions through the application config", () => {
  beforeEach(() => {
    authDb.reset();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_SECRET", "test-only-auth-secret-not-for-production");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    vi.stubEnv("AUTH_URL", "");
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-google-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-google-secret");
    vi.stubEnv("GITHUB_CLIENT_ID", "test-github-client");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "test-github-secret");
    vi.stubEnv("ADMIN_WHITELIST", "");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fails closed with null instead of a truthy error-config object", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { auth } = await importApplicationAuth();

    const request = { headers: requestHeaders() };
    const response = { headers: new Headers() };
    const session = await (
      auth as unknown as (
        request: unknown,
        response: unknown,
      ) => Promise<unknown>
    )(request, response);

    expect(session).toBeNull();
    expect(Boolean(session)).toBe(false);
    expect(consoleError).toHaveBeenCalled();
  });

  it("creates User, Account and a database session/cookie through the real Google callback", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256", {
      modulusLength: 2048,
      extractable: true,
    });
    const publicJwk = await exportJWK(publicKey);
    Object.assign(publicJwk, {
      kid: "test-google-key",
      use: "sig",
      alg: "RS256",
    });
    let idToken = "";

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === "https://accounts.google.com/.well-known/openid-configuration") {
        return jsonResponse({
          issuer: "https://accounts.google.com",
          authorization_endpoint:
            "https://accounts.google.com/o/oauth2/v2/auth",
          token_endpoint: "https://oauth2.googleapis.com/token",
          userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
          jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
          code_challenge_methods_supported: ["S256"],
        });
      }
      if (url === "https://www.googleapis.com/oauth2/v3/certs") {
        return jsonResponse({ keys: [publicJwk] });
      }
      if (url === "https://oauth2.googleapis.com/token") {
        return jsonResponse({
          access_token: "test-google-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          id_token: idToken,
        });
      }
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        return jsonResponse({
          sub: "google-test-subject",
          name: "Google Test User",
          email: "google-user@example.com",
          email_verified: true,
        });
      }
      throw new Error(`unexpected_external_oauth_request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handlers } = await importApplicationAuth();
    const { cookie } = await beginOAuth(handlers, "google");
    idToken = await new SignJWT({
      name: "Google Test User",
      email: "google-user@example.com",
      email_verified: true,
      picture: "https://auth.test/google-avatar.png",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-google-key" })
      .setIssuer("https://accounts.google.com")
      .setAudience("test-google-client")
      .setSubject("google-test-subject")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    const response = await handlers.GET(
      new NextRequest(
        `${TEST_ORIGIN}/api/auth/callback/google?code=test-google-code`,
        { headers: requestHeaders(cookie) },
      ),
    );

    expectDatabaseOAuthSession(
      "google",
      "google-test-subject",
      "google-user@example.com",
      response,
    );
    expect(authDb.prisma.user.create).toHaveBeenCalledTimes(1);
    expect(authDb.prisma.account.create).toHaveBeenCalledTimes(1);
    expect(authDb.prisma.session.create).toHaveBeenCalledTimes(1);
  });

  it("creates User, Account and a database session/cookie through the real GitHub callback", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === "https://github.com/login/oauth/access_token") {
        return jsonResponse({
          access_token: "test-github-access-token",
          token_type: "bearer",
          scope: "read:user,user:email",
        });
      }
      if (url === "https://api.github.com/user") {
        return jsonResponse({
          id: 123456,
          login: "octo-test",
          name: "GitHub Test User",
          email: "github-user@example.com",
          avatar_url: "https://auth.test/github-avatar.png",
        });
      }
      throw new Error(`unexpected_external_oauth_request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { handlers } = await importApplicationAuth();
    const { cookie } = await beginOAuth(handlers, "github");
    const response = await handlers.GET(
      new NextRequest(
        `${TEST_ORIGIN}/api/auth/callback/github?code=test-github-code`,
        { headers: requestHeaders(cookie) },
      ),
    );

    expectDatabaseOAuthSession(
      "github",
      "123456",
      "github-user@example.com",
      response,
    );
    expect(authDb.prisma.user.create).toHaveBeenCalledTimes(1);
    expect(authDb.prisma.account.create).toHaveBeenCalledTimes(1);
    expect(authDb.prisma.session.create).toHaveBeenCalledTimes(1);
  });

  it("persists createDatabaseSession expiry and returns secure production cookie attributes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { createDatabaseSession } = await import("@/lib/session");

    const before = Date.now();
    const cookie = await createDatabaseSession("user-session-test");
    const stored = authDb.state.sessions[0];

    expect(authDb.prisma.session.create).toHaveBeenCalledTimes(1);
    expect(stored.userId).toBe("user-session-test");
    expect(stored.sessionToken).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.expires).toEqual(new Date(before + THIRTY_DAYS_MS));
    expect(cookie).toEqual({
      name: "__Secure-authjs.session-token",
      value: stored.sessionToken,
      expires: stored.expires,
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
  });

  it("confirms malformed Bearer/getToken is not applicable to this application", () => {
    const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (/\.tsx?$/.test(entry.name)) files.push(path);
      }
    };
    visit(sourceRoot);
    const consumers = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        /from\s+["']next-auth\/jwt["']/.test(source) ||
        /\bgetToken\s*\(/.test(source)
      );
    });
    expect(consumers).toEqual([]);
  });
});
