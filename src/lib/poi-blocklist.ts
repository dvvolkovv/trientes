// Hosts whose OSM POIs must not appear on the public navigator map.
// Match is host-suffix: blocking "sangita.com" also drops "shop.sangita.com".
// Bare hostnames; no scheme. Lower-case.
const BLOCKED_HOSTS = new Set<string>([
  "sangita.com",
]);

export function isWebsiteBlocked(url: string | null | undefined): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  if (BLOCKED_HOSTS.has(host)) return true;
  // Suffix match: blocking "example.com" also blocks "sub.example.com".
  for (const blocked of BLOCKED_HOSTS) {
    if (host.endsWith(`.${blocked}`)) return true;
  }
  return false;
}
