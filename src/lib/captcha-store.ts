/**
 * Подпись задачи и её одноразовость.
 *
 * Задача не секрет: точка сборки нарисована на экране, значит известна и
 * роботу, читающему DOM. Подпись защищает не от решения, а от выдумывания
 * задачи и от повтора: выдана сервером, тому же адресу, не старше пяти минут,
 * предъявлена один раз.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { redis } from "@/lib/redis";
import { MAX_AGE_MS, newGeometry, type Geometry, type Point } from "@/lib/captcha";

export type TokenPayload = {
  nonce: string;
  issuedAt: number;
  ipHash: string;
  home: Point;
};

function secretKey(): string {
  return (
    process.env.CAPTCHA_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    "trientes-captcha-dev"
  );
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(`captcha:${ip}`).digest("hex").slice(0, 16);
}

export function signToken(p: TokenPayload, secret: string = secretKey()): string {
  // Длины полей внутри подписываемой строки: иначе склейка ("ab","c") и
  // ("a","bc") дала бы одну и ту же строку под подписью.
  const body = [p.nonce, String(p.issuedAt), p.ipHash, String(p.home.x), String(p.home.y)]
    .map((part) => `${part.length}:${part}`)
    .join("|");
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function packToken(p: TokenPayload, secret: string = secretKey()): string {
  return [p.nonce, p.issuedAt, p.ipHash, p.home.x, p.home.y, signToken(p, secret)].join(".");
}

export function parseToken(token: unknown, secret: string = secretKey()): TokenPayload | null {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 6) return null;
  const [nonce, issuedRaw, ipHash, xRaw, yRaw, sig] = parts;
  const issuedAt = Number(issuedRaw);
  const x = Number(xRaw);
  const y = Number(yRaw);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const payload: TokenPayload = { nonce, issuedAt, ipHash, home: { x, y } };
  const expected = Buffer.from(signToken(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return payload;
}

const KEY = (nonce: string) => `captcha:${nonce}`;

/** Выдать задачу: геометрия, подписанный токен и строка в Redis. */
export async function issueChallenge(ip: string): Promise<Geometry & { token: string }> {
  const g = newGeometry();
  const payload: TokenPayload = {
    nonce: randomBytes(9).toString("base64url"),
    issuedAt: Date.now(),
    ipHash: hashIp(ip),
    home: g.home,
  };
  try {
    await redis.set(KEY(payload.nonce), "1", "PX", MAX_AGE_MS);
  } catch (err) {
    // Redis лёг — задача остаётся подписанной и срочной, но перестаёт быть
    // одноразовой. Запереть дверь было бы хуже: тогда никто не сможет
    // зарегистрироваться, пока Redis моргает.
    console.warn("[captcha] store unavailable on issue", err);
  }
  return { ...g, token: packToken(payload) };
}

/** Погасить задачу. `true` — она была цела и теперь погашена. */
export async function consume(nonce: string): Promise<boolean> {
  try {
    return (await redis.del(KEY(nonce))) === 1;
  } catch (err) {
    console.warn("[captcha] store unavailable on consume", err);
    return true; // см. довод выше
  }
}

/** Выдача дешёвая, но не бесплатная: 60 задач с адреса за 10 минут. */
export async function tooManyIssues(ip: string): Promise<boolean> {
  const key = `captcha:issues:${hashIp(ip)}`;
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.pexpire(key, 10 * 60 * 1000);
    return n > 60;
  } catch {
    return false;
  }
}
