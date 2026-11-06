import { getRequestConfig } from "next-intl/server";
import { notFound } from "next/navigation";
import { SUPPORTED_LOCALES, type Locale } from "@/lib/locales";

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) as Locale | undefined;
  if (!locale || !SUPPORTED_LOCALES.includes(locale)) notFound();
  // English is merged in as a base so a key missing from a translation falls
  // back to readable English instead of rendering its raw dotted path to the
  // user. Deep merge: a locale may translate part of a namespace.
  const base = (await import("../messages/en.json")).default as unknown as Tree;
  const messages =
    locale === "en"
      ? base
      : deepMerge(base, (await import(`../messages/${locale}.json`)).default as unknown as Tree);
  return { locale, messages };
});

type Node = string | string[] | Tree;
type Tree = { [k: string]: Node };

/** Arrays (e.g. home.ticker.phrases) are replaced wholesale, never merged. */
function deepMerge(base: Tree, over: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    const mergeable =
      v && typeof v === "object" && !Array.isArray(v) &&
      b && typeof b === "object" && !Array.isArray(b);
    out[k] = mergeable ? deepMerge(b as Tree, v as Tree) : v;
  }
  return out;
}
