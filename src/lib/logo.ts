// Universal fallback logo URL derived from a website domain. Uses DuckDuckGo's
// ip3 favicon proxy because it works without an API key and serves PNG/ICO for
// every public domain. Quality varies — admins can override with a curated URL.
export function logoForDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const host = new URL(website).hostname.replace(/^www\./, "");
    if (!host) return null;
    return `https://icons.duckduckgo.com/ip3/${host}.ico`;
  } catch {
    return null;
  }
}
