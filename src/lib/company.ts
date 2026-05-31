// Pure validation for company profiles and point submissions. No I/O.

const POINT_TYPES = ["SHOP", "ATM", "POS", "SALES_OFFICE", "COMPANY", "ONLINE"] as const;
export type PointTypeStr = (typeof POINT_TYPES)[number];

// Accepts "https://x.com", "http://x.com", "www.x.com", or bare "x.com".
// Returns the canonical https:// form, or "invalid" if the input is unusable.
function normalizeUrl(raw: string | null | undefined): string | null | "invalid" {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/\s/.test(s)) return "invalid";
  // Already has a scheme — accept only http/https.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "invalid";
      return u.toString().replace(/\/$/, "");
    } catch {
      return "invalid";
    }
  }
  // No scheme — must look like a domain (contains a dot, ≥2 chars per label).
  const stripped = s.replace(/^www\./i, "");
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([/?#].*)?$/i.test(stripped)) return "invalid";
  try {
    const u = new URL(`https://${s}`);
    if (u.protocol !== "https:") return "invalid";
    return u.toString().replace(/\/$/, "");
  } catch {
    return "invalid";
  }
}

type StructuredAddress = {
  countryCode: string | null;
  city: string | null;
  street: string | null;
  houseNumber: string | null;
  postalCode: string | null;
};

function buildDisplayAddress(a: StructuredAddress, countryName: string | null): string | null {
  const line1 = [a.street, a.houseNumber].map((x) => x?.trim()).filter(Boolean).join(" ");
  const line2 = [a.postalCode, a.city].map((x) => x?.trim()).filter(Boolean).join(" ");
  const parts = [line1, line2, countryName?.trim()].filter((x) => x && x.length > 0);
  return parts.length ? parts.join(", ") : null;
}

const t = (v: string | null | undefined) => { const s = (v ?? "").trim(); return s ? s : null; };

// ISO-3166 alpha-2: 2 ascii letters.
function normalizeCountryCode(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

export type CompanyProfileInput = {
  legalName?: string | null;
  displayName?: string | null;
  description?: string | null;
  country?: string | null;
  countryCode?: string | null;
  city?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  postalCode?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoUrl?: string | null;
};
export type ValidatedProfile = {
  legalName: string; displayName: string; description: string | null;
  country: string | null; countryCode: string | null;
  city: string | null; street: string | null; houseNumber: string | null; postalCode: string | null;
  address: string | null; phone: string | null; email: string | null; website: string | null; logoUrl: string | null;
};
export type ProfileResult =
  | { ok: true; data: ValidatedProfile }
  | { ok: false; reason: "legal_name_required" | "display_name_required" | "website_invalid" | "logo_invalid" };

export function validateCompanyProfile(input: CompanyProfileInput): ProfileResult {
  const legalName = (input.legalName ?? "").trim();
  const displayName = (input.displayName ?? "").trim();
  if (!legalName) return { ok: false, reason: "legal_name_required" };
  if (!displayName) return { ok: false, reason: "display_name_required" };
  const website = normalizeUrl(input.website);
  if (website === "invalid") return { ok: false, reason: "website_invalid" };
  const logoUrl = normalizeUrl(input.logoUrl);
  if (logoUrl === "invalid") return { ok: false, reason: "logo_invalid" };
  const structured: StructuredAddress = {
    countryCode: normalizeCountryCode(input.countryCode),
    city: t(input.city), street: t(input.street),
    houseNumber: t(input.houseNumber), postalCode: t(input.postalCode),
  };
  // Prefer explicit `address` if provided; otherwise build from structured parts.
  const address = t(input.address) ?? buildDisplayAddress(structured, t(input.country));
  return {
    ok: true,
    data: {
      legalName, displayName, description: t(input.description),
      country: t(input.country), ...structured, address,
      phone: t(input.phone), email: t(input.email), website, logoUrl,
    },
  };
}

export type CompanyPointInput = {
  type?: string | null;
  name?: string | null;
  description?: string | null;
  lat?: number | null;
  lon?: number | null;
  countryCode?: string | null;
  city?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  postalCode?: string | null;
  address?: string | null;
  acceptedCoinIds?: string[] | null;
  logoUrl?: string | null;
  photos?: { url: string; label?: string | null }[] | null;
  openingHours?: string | null;
  phone?: string | null;
  website?: string | null;
};
export type PointPhoto = { url: string; label: string | null };
export type ValidatedPoint = {
  type: PointTypeStr; name: string; description: string | null;
  // Online-only services skip coords entirely; everything else must have them.
  lat: number | null; lon: number | null;
  countryCode: string | null; city: string | null; street: string | null;
  houseNumber: string | null; postalCode: string | null;
  address: string | null; acceptedCoinIds: string[]; logoUrl: string | null;
  photos: PointPhoto[];
  openingHours: string | null; phone: string | null; website: string | null;
};

// Storefront photos: keep first 5, drop any URL that isn't http(s) or a local
// /uploads/ path. Label trimmed to 80 chars to keep popups tidy.
export function sanitizePointPhotos(raw: unknown): PointPhoto[] {
  if (!Array.isArray(raw)) return [];
  const out: PointPhoto[] = [];
  for (const item of raw) {
    if (out.length >= 5) break;
    if (!item || typeof item !== "object") continue;
    const url = (item as { url?: unknown }).url;
    const label = (item as { label?: unknown }).label;
    if (typeof url !== "string" || !url.trim()) continue;
    const trimmed = url.trim();
    let ok = false;
    if (trimmed.startsWith("/uploads/")) ok = true;
    else {
      try {
        const u = new URL(trimmed);
        ok = u.protocol === "http:" || u.protocol === "https:";
      } catch { ok = false; }
    }
    if (!ok) continue;
    const cleanLabel = typeof label === "string" && label.trim() ? label.trim().slice(0, 80) : null;
    out.push({ url: trimmed, label: cleanLabel });
  }
  return out;
}
export type PointResult =
  | { ok: true; data: ValidatedPoint }
  | { ok: false; reason: "type_invalid" | "name_required" | "coords_invalid" | "website_invalid" | "logo_invalid" };

export function validateCompanyPoint(input: CompanyPointInput): PointResult {
  const type = (input.type ?? "") as PointTypeStr;
  if (!POINT_TYPES.includes(type)) return { ok: false, reason: "type_invalid" };
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, reason: "name_required" };

  // ONLINE-only services have no physical location, so coords are skipped.
  // Anything physical (shop / ATM / POS / sales office / company HQ) still
  // needs a valid pair so the navigator can pin it.
  let lat: number | null = null;
  let lon: number | null = null;
  if (type !== "ONLINE") {
    if (input.lat == null || input.lon == null) return { ok: false, reason: "coords_invalid" };
    const la = Number(input.lat);
    const lo = Number(input.lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180)
      return { ok: false, reason: "coords_invalid" };
    if (la === 0 && lo === 0) return { ok: false, reason: "coords_invalid" }; // Null Island
    lat = la; lon = lo;
  }

  const website = normalizeUrl(input.website);
  if (website === "invalid") return { ok: false, reason: "website_invalid" };
  const logoUrl = normalizeUrl(input.logoUrl);
  if (logoUrl === "invalid") return { ok: false, reason: "logo_invalid" };
  const acceptedCoinIds = Array.from(
    new Set((input.acceptedCoinIds ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean)),
  );
  const structured: StructuredAddress = {
    countryCode: normalizeCountryCode(input.countryCode),
    city: t(input.city), street: t(input.street),
    houseNumber: t(input.houseNumber), postalCode: t(input.postalCode),
  };
  const address = t(input.address) ?? buildDisplayAddress(structured, null);
  return {
    ok: true,
    data: {
      type, name, description: t(input.description), lat, lon, ...structured, address,
      acceptedCoinIds, logoUrl,
      photos: sanitizePointPhotos(input.photos),
      openingHours: t(input.openingHours), phone: t(input.phone), website,
    },
  };
}
