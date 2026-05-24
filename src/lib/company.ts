// Pure validation for company profiles and point submissions. No I/O.

const POINT_TYPES = ["SHOP", "ATM", "POS", "SALES_OFFICE"] as const;
export type PointTypeStr = (typeof POINT_TYPES)[number];

function httpOrNull(raw: string | null | undefined): string | null | "invalid" {
  const s = (raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : "invalid";
  } catch {
    return "invalid";
  }
}

export type CompanyProfileInput = {
  legalName?: string | null;
  displayName?: string | null;
  description?: string | null;
  country?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoUrl?: string | null;
};
export type ValidatedProfile = {
  legalName: string; displayName: string; description: string | null; country: string | null;
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
  const website = httpOrNull(input.website);
  if (website === "invalid") return { ok: false, reason: "website_invalid" };
  const logoUrl = httpOrNull(input.logoUrl);
  if (logoUrl === "invalid") return { ok: false, reason: "logo_invalid" };
  const t = (v: string | null | undefined) => { const s = (v ?? "").trim(); return s ? s : null; };
  return {
    ok: true,
    data: { legalName, displayName, description: t(input.description), country: t(input.country),
      address: t(input.address), phone: t(input.phone), email: t(input.email), website, logoUrl },
  };
}

export type CompanyPointInput = {
  type?: string | null;
  name?: string | null;
  description?: string | null;
  lat?: number | null;
  lon?: number | null;
  address?: string | null;
  acceptedCoinIds?: string[] | null;
  logoUrl?: string | null;
  openingHours?: string | null;
  phone?: string | null;
  website?: string | null;
};
export type ValidatedPoint = {
  type: PointTypeStr; name: string; description: string | null; lat: number; lon: number;
  address: string | null; acceptedCoinIds: string[]; logoUrl: string | null;
  openingHours: string | null; phone: string | null; website: string | null;
};
export type PointResult =
  | { ok: true; data: ValidatedPoint }
  | { ok: false; reason: "type_invalid" | "name_required" | "coords_invalid" | "website_invalid" | "logo_invalid" };

export function validateCompanyPoint(input: CompanyPointInput): PointResult {
  const type = (input.type ?? "") as PointTypeStr;
  if (!POINT_TYPES.includes(type)) return { ok: false, reason: "type_invalid" };
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, reason: "name_required" };
  if (input.lat == null || input.lon == null) return { ok: false, reason: "coords_invalid" };
  const lat = Number(input.lat);
  const lon = Number(input.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return { ok: false, reason: "coords_invalid" };
  const website = httpOrNull(input.website);
  if (website === "invalid") return { ok: false, reason: "website_invalid" };
  const logoUrl = httpOrNull(input.logoUrl);
  if (logoUrl === "invalid") return { ok: false, reason: "logo_invalid" };
  const acceptedCoinIds = Array.from(
    new Set((input.acceptedCoinIds ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean)),
  );
  const t = (v: string | null | undefined) => { const s = (v ?? "").trim(); return s ? s : null; };
  return {
    ok: true,
    data: { type, name, description: t(input.description), lat, lon, address: t(input.address),
      acceptedCoinIds, logoUrl, openingHours: t(input.openingHours), phone: t(input.phone), website },
  };
}
