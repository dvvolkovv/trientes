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

export const CURATED_POIS: CuratedPoi[] = [
  {
    id: "curated/sangita",
    name: "Sangita Yoga Studio",
    lat: 48.2105932,
    lon: 16.3768773,
    category: "Yoga / Wellness",
    address: "Fleischmarkt 16, 1010 Wien",
    website: "https://sangita.com",
    phone: "+43 676 5734954",
    email: "info@sangita.com",
    socials: [{ network: "instagram", url: "https://instagram.com/sangita_yoga_studio" }],
    logo: "/curated/sangita.png",
    lightning: false,
  },
];
