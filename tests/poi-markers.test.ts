import { describe, expect, it } from "vitest";
import type { Poi, PoiLayer } from "@/lib/crypto-map";
import { poiLogoSrc, showsLogoMarker } from "@/lib/poi-markers";

const VISIBLE: Record<PoiLayer, boolean> = {
  merchant: true,
  atm: true,
  financial: true,
  fintech: true,
};

function poi(over: Partial<Poi> = {}): Poi {
  return {
    id: "company/1",
    lat: 50,
    lon: 14,
    name: "Кафе",
    layer: "merchant",
    category: "Cafe",
    address: null,
    lightning: false,
    coinSpecific: false,
    acceptedCoins: [],
    acceptedGeneric: true,
    photos: [],
    website: null,
    openingHours: null,
    phone: null,
    email: null,
    socials: [],
    image: null,
    logoUrl: "/uploads/points/logo.png",
    description: null,
    ...over,
  } as Poi;
}

describe("poiLogoSrc", () => {
  it("берёт наш путь загрузки как есть", () => {
    expect(poiLogoSrc({ logoUrl: "/uploads/points/logo.png" })).toBe("/uploads/points/logo.png");
  });

  it("берёт чужой адрес только по http(s)", () => {
    expect(poiLogoSrc({ logoUrl: "https://example.org/logo.svg" })).toBe("https://example.org/logo.svg");
    expect(poiLogoSrc({ logoUrl: "javascript:alert(1)" })).toBeNull();
    expect(poiLogoSrc({ logoUrl: "data:image/svg+xml,<svg/>" })).toBeNull();
  });

  it("не принимает за свой путь адрес без схемы", () => {
    expect(poiLogoSrc({ logoUrl: "//evil.example/logo.png" })).toBeNull();
  });

  it("пустой знак — это отсутствие знака", () => {
    expect(poiLogoSrc({ logoUrl: "   " })).toBeNull();
    expect(poiLogoSrc({ logoUrl: null })).toBeNull();
  });
});

describe("showsLogoMarker", () => {
  it("ставит метку точке со знаком", () => {
    expect(showsLogoMarker(poi(), { visible: VISIBLE, coinOnly: false })).toBe(true);
  });

  it("не ставит метку точке без знака — там остаётся кружок слоя", () => {
    expect(showsLogoMarker(poi({ logoUrl: null }), { visible: VISIBLE, coinOnly: false })).toBe(false);
  });

  it("прячет метку вместе с её слоем", () => {
    const visible = { ...VISIBLE, merchant: false };
    expect(showsLogoMarker(poi(), { visible, coinOnly: false })).toBe(false);
  });

  it("слушается фильтра «только монета страницы»", () => {
    expect(showsLogoMarker(poi(), { visible: VISIBLE, coinOnly: true })).toBe(false);
    expect(showsLogoMarker(poi({ coinSpecific: true }), { visible: VISIBLE, coinOnly: true })).toBe(true);
  });
});
