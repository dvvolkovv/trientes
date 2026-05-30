import { z } from "zod";

export const SLUG_RE = /^[a-z0-9-]{2,40}$/;

// ISO-3166-1 alpha-2. Kept as an inline Set for O(1) check; the catalog is stable.
const ISO_3166_ALPHA2 = new Set<string>([
  "AD","AE","AF","AG","AI","AL","AM","AO","AQ","AR","AS","AT","AU","AW","AX","AZ",
  "BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS","BT","BV","BW","BY","BZ",
  "CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN","CO","CR","CU","CV","CW","CX","CY","CZ",
  "DE","DJ","DK","DM","DO","DZ",
  "EC","EE","EG","EH","ER","ES","ET",
  "FI","FJ","FK","FM","FO","FR",
  "GA","GB","GD","GE","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY",
  "HK","HM","HN","HR","HT","HU",
  "ID","IE","IL","IM","IN","IO","IQ","IR","IS","IT",
  "JE","JM","JO","JP",
  "KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ",
  "LA","LB","LC","LI","LK","LR","LS","LT","LU","LV","LY",
  "MA","MC","MD","ME","MF","MG","MH","MK","ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ",
  "NA","NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ",
  "OM",
  "PA","PE","PF","PG","PH","PK","PL","PM","PN","PR","PS","PT","PW","PY",
  "QA",
  "RE","RO","RS","RU","RW",
  "SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS","ST","SV","SX","SY","SZ",
  "TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO","TR","TT","TV","TW","TZ",
  "UA","UG","UM","US","UY","UZ",
  "VA","VC","VE","VG","VI","VN","VU",
  "WF","WS",
  "YE","YT",
  "ZA","ZM","ZW",
]);

// ISO-4217. Limited to currencies fintechs realistically support.
const ISO_4217 = new Set<string>([
  "USD","EUR","GBP","CHF","JPY","CNY","HKD","SGD","AUD","CAD","NZD",
  "SEK","NOK","DKK","PLN","CZK","HUF","RON","BGN","HRK","ISK",
  "TRY","UAH","RUB","KZT","GEL",
  "AED","SAR","QAR","ILS",
  "INR","IDR","THB","VND","MYR","PHP","KRW","TWD",
  "BRL","MXN","ARS","CLP","COP","PEN",
  "ZAR","NGN","KES","EGP",
]);

export const FINTECH_SERVICES = [
  "CARD","IBAN","SEPA","SWIFT","SAVINGS","CRYPTO_LOANS",
  "STAKING","EXCHANGE","CUSTODY","PAYMENTS","ONRAMP","OFFRAMP",
] as const;

export const FINTECH_KYC = ["NONE","BASIC","FULL"] as const;

export function isValidCountryCode(cc: string): boolean {
  return ISO_3166_ALPHA2.has(cc);
}

export function isValidFiat(code: string): boolean {
  return ISO_4217.has(code);
}

export type FintechSocial = { network: string; url: string };

export function sanitizeFintechSocials(raw: unknown): FintechSocial[] {
  if (!Array.isArray(raw)) return [];
  const out: FintechSocial[] = [];
  for (const item of raw) {
    if (out.length >= 10) break;
    if (!item || typeof item !== "object") continue;
    const network = (item as { network?: unknown }).network;
    const url = (item as { url?: unknown }).url;
    if (typeof network !== "string" || !network.trim()) continue;
    if (typeof url !== "string") continue;
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    } catch {
      continue;
    }
    out.push({ network: network.trim(), url });
  }
  return out;
}

const httpUrl = z.string().url().refine((s) => {
  try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; }
  catch { return false; }
}, "must be http(s) URL");

const optionalHttpUrl = httpUrl.optional().nullable();

export const fintechCreateSchema = z
  .object({
    slug: z.string().regex(SLUG_RE, "invalid slug"),
    displayName: z.string().min(2).max(80),
    legalName: z.string().max(120).optional().nullable(),
    logoUrl: optionalHttpUrl,
    description: z.string().max(4000).optional().nullable(),
    website: httpUrl,
    socials: z.array(z.object({ network: z.string().min(1).max(40), url: httpUrl })).max(10).optional().nullable(),
    foundedYear: z.number().int().min(1900).max(2100).optional().nullable(),

    countryCode: z.string().refine(isValidCountryCode, "unknown country").optional().nullable(),
    city: z.string().max(80).optional().nullable(),
    address: z.string().max(200).optional().nullable(),
    hqLat: z.number().min(-90).max(90).optional().nullable(),
    hqLon: z.number().min(-180).max(180).optional().nullable(),

    services: z.array(z.enum(FINTECH_SERVICES)).max(FINTECH_SERVICES.length),
    supportedCoinIds: z.array(z.string().min(1).max(60)).max(30),
    supportedFiats: z.array(z.string().refine(isValidFiat, "unknown fiat")).max(20),
    availableIn: z.array(z.string().refine(isValidCountryCode, "unknown country")).max(30),

    kycLevel: z.enum(FINTECH_KYC).optional().nullable(),
    feesSummary: z.string().max(2000).optional().nullable(),
    appStoreUrl: optionalHttpUrl,
    playStoreUrl: optionalHttpUrl,
  })
  .superRefine((v, ctx) => {
    const hasLat = v.hqLat !== undefined && v.hqLat !== null;
    const hasLon = v.hqLon !== undefined && v.hqLon !== null;
    if (hasLat !== hasLon) {
      ctx.addIssue({ code: "custom", message: "hqLat and hqLon must both be provided", path: ["hqLat"] });
    }
    if (hasLat && hasLon && v.hqLat === 0 && v.hqLon === 0) {
      ctx.addIssue({ code: "custom", message: "(0,0) is not a valid location", path: ["hqLat"] });
    }
  });

export type FintechCreateInput = z.infer<typeof fintechCreateSchema>;
