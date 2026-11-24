import { describe, expect, it } from "vitest";
import {
  claimsSwipe,
  dragOffset,
  pageLabelKey,
  pagesFor,
  settlePage,
  type PoiPage,
} from "@/lib/poi-pager";

const ALL: PoiPage[] = ["map", "route", "card", "showcase"];
const PHONE: PoiPage[] = ["map", "card", "showcase"];

describe("pagesFor", () => {
  it("gives the phone three pages and opens on the facts", () => {
    expect(pagesFor(true)).toEqual(["map", "card", "showcase"]);
  });

  it("gives the desktop a route page instead of the map window", () => {
    // Окно в полотно рядом с настоящей картой ничего не покупает, а управление
    // маршрутом — покупает: подвалом панели оно съедало её целиком (слайс CF).
    expect(pagesFor(false)).toEqual(["route", "card", "showcase"]);
  });

  it("opens on the facts on both", () => {
    for (const phone of [true, false]) {
      expect(pagesFor(phone)[1]).toBe("card");
    }
  });
});

describe("pageLabelKey", () => {
  it("never reuses a label", () => {
    const keys = ALL.map(pageLabelKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("claimsSwipe", () => {
  const folded = { fromEdge: false, mapExpanded: false };

  it("ignores a vertical drag — that is page scrolling", () => {
    expect(claimsSwipe({ page: "card", dx: 20, dy: 40, ...folded })).toBe(false);
  });

  it("ignores a tremor below the threshold", () => {
    expect(claimsSwipe({ page: "card", dx: 6, dy: 0, ...folded })).toBe(false);
  });

  it("takes a clearly horizontal drag on the facts page from anywhere", () => {
    expect(claimsSwipe({ page: "card", dx: -40, dy: 5, ...folded })).toBe(true);
  });

  it("takes the same drag over the folded map window — a tile has nothing to pan", () => {
    expect(claimsSwipe({ page: "map", dx: -80, dy: 2, ...folded })).toBe(true);
  });

  it("leaves the middle of the expanded map to the map itself", () => {
    expect(claimsSwipe({ page: "map", dx: -80, dy: 2, fromEdge: false, mapExpanded: true })).toBe(false);
  });

  it("still listens at the edge strip of the expanded map", () => {
    expect(claimsSwipe({ page: "map", dx: -80, dy: 2, fromEdge: true, mapExpanded: true })).toBe(true);
  });

  it("answers a short deliberate flick — the finger must not have to travel", () => {
    expect(claimsSwipe({ page: "card", dx: -10, dy: 3, ...folded })).toBe(true);
  });
});

describe("settlePage", () => {
  const base = { pages: PHONE, page: "card" as PoiPage, width: 400, velocity: 0 };

  it("snaps back when the drag is too short and slow", () => {
    expect(settlePage({ ...base, dx: -40 })).toBe("card");
  });

  it("turns the page past a fifth of the width", () => {
    expect(settlePage({ ...base, dx: -140 })).toBe("showcase");
    expect(settlePage({ ...base, dx: 140 })).toBe("map");
  });

  it("turns the page on a fast short flick", () => {
    expect(settlePage({ ...base, dx: -30, velocity: 0.3 })).toBe("showcase");
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
