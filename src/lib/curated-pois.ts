// Hand-curated crypto-accepting businesses that aren't (well) mapped in OSM.
// Rendered in the navigator as logo markers, always visible regardless of zoom or
// Overpass coverage. Type-only import from crypto-map keeps this client-safe.
import type { Social } from "@/lib/crypto-map";

export type CuratedPoi = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
  address: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  socials: Social[];
  logo: string; // path under /public
  lightning: boolean;
};

export const CURATED_POIS: CuratedPoi[] = [];
