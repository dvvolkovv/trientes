import { pickLocale } from "@/lib/locales";

type Tree = { [k: string]: unknown };

const cache = new Map<string, Tree>();

async function load(locale: string): Promise<Tree> {
  const hit = cache.get(locale);
  if (hit) return hit;
  const mod = (await import(`../../messages/${locale}.json`)) as { default: Tree };
  cache.set(locale, mod.default);
  return mod.default;
}

function lookup(tree: Tree, path: string): string | null {
  let node: unknown = tree;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return null;
    node = (node as Tree)[part];
  }
  return typeof node === "string" ? node : null;
}

function interpolate(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}

/**
 * Строка перевода без контекста запроса. Нужна воркеру: `getTranslations`
 * ходит через `requestLocale` и вне запроса падает.
 *
 * Английский подмешивается как база — ровно как в `src/i18n.ts`: ключ, которого
 * нет в переводе, должен выйти читаемой фразой, а не точечным путём.
 */
export async function rawMessage(
  locale: string | null | undefined,
  path: string,
  vars: Record<string, string | number> = {},
  fallback?: string,
): Promise<string> {
  const l = pickLocale(locale);
  let text: string | null = null;
  try {
    text = lookup(await load(l), path);
    if (!text && l !== "en") text = lookup(await load("en"), path);
  } catch {
    text = null;
  }
  return interpolate(text ?? fallback ?? path, vars);
}
