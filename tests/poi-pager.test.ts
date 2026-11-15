import { describe, expect, it } from "vitest";
import {
  claimsSwipe,
  dragOffset,
  pageLabelKey,
  pagesFor,
  settlePage,
  type PoiPage,
} from "@/lib/poi-pager";

const PHONE: PoiPage[] = ["map", "card", "showcase"];

describe("pagesFor", () => {
  it("gives the phone three pages and opens on the facts", () => {
    expect(pagesFor(true)).toEqual(["map", "card", "showcase"]);
  });

  it("drops the map page on desktop, where the map is already beside the panel", () => {
    expect(pagesFor(false)).toEqual(["card", "showcase"]);
  });
});

describe("pageLabelKey", () => {
  it("never reuses a label", () => {
    const keys = PHONE.map(pageLabelKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("claimsSwipe", () => {
  it("ignores a vertical drag — that is page scrolling", () => {
    expect(claimsSwipe({ page: "card", dx: 20, dy: 40, fromEdge: false })).toBe(false);
  });

  it("ignores a tremor below the threshold", () => {
    expect(claimsSwipe({ page: "card", dx: 8, dy: 0, fromEdge: false })).toBe(false);
  });

  it("takes a clearly horizontal drag on the facts page from anywhere", () => {
    expect(claimsSwipe({ page: "card", dx: -40, dy: 5, fromEdge: false })).toBe(true);
  });

  it("leaves the middle of the map page to the map itself", () => {
    expect(claimsSwipe({ page: "map", dx: -80, dy: 2, fromEdge: false })).toBe(false);
  });

  it("still listens at the edge strip of the map page", () => {
    expect(claimsSwipe({ page: "map", dx: -80, dy: 2, fromEdge: true })).toBe(true);
  });
});

describe("settlePage", () => {
  const base = { pages: PHONE, page: "card" as PoiPage, width: 400, velocity: 0 };

  it("snaps back when the drag is too short and slow", () => {
    expect(settlePage({ ...base, dx: -60 })).toBe("card");
  });

  it("turns the page past a quarter of the width", () => {
    expect(settlePage({ ...base, dx: -140 })).toBe("showcase");
    expect(settlePage({ ...base, dx: 140 })).toBe("map");
  });

  it("turns the page on a fast short flick", () => {
    expect(settlePage({ ...base, dx: -30, velocity: 0.9 })).toBe("showcase");
  });

  it("cannot go past the ends", () => {
    expect(settlePage({ ...base, page: "map", dx: 200 })).toBe("map");
    expect(settlePage({ ...base, page: "showcase", dx: -200 })).toBe("showcase");
  });

  it("knows nothing of the map page on desktop", () => {
    expect(settlePage({ ...base, pages: ["card", "showcase"], page: "card", dx: 200 })).toBe("card");
  });
});

describe("dragOffset", () => {
  it("follows the finger inside the deck", () => {
    expect(dragOffset({ pages: PHONE, page: "card", dx: -50, width: 400 })).toBe(-450);
  });

  it("resists past the first page instead of tearing off", () => {
    const offset = dragOffset({ pages: PHONE, page: "map", dx: 100, width: 400 });
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(100);
  });
});
