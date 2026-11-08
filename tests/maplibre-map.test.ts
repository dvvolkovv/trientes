import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  webgl2: true,
  behaviour: "ok" as "ok" | "throws" | "no-painter",
  constructed: [] as unknown[],
}));

vi.mock("@/lib/webgl-support", () => ({
  supportsWebGL2: () => state.webgl2,
}));

vi.mock("maplibre-gl", () => ({
  Map: class FakeMap {
    painter: unknown;
    constructor(public options: unknown) {
      state.constructed.push(options);
      if (state.behaviour === "throws") throw new Error("Failed to initialize WebGL");
      // MapLibre 6.4.1 does not throw without WebGL2: it fires an "error" event
      // and returns a map that has no painter (its remove() then throws).
      this.painter = state.behaviour === "no-painter" ? undefined : {};
    }
  },
}));

import { tryCreateMap } from "@/lib/maplibre-map";

const container = {} as HTMLElement;

beforeEach(() => {
  state.webgl2 = true;
  state.behaviour = "ok";
  state.constructed = [];
  vi.restoreAllMocks();
});

describe("tryCreateMap", () => {
  it("creates the map with the given options when WebGL2 works", () => {
    const options = { container, style: "https://tiles.test/style.json", zoom: 12 };

    const map = tryCreateMap(options);

    expect(map).not.toBeNull();
    expect(state.constructed).toEqual([options]);
  });

  it("does not construct MapLibre at all without WebGL2", () => {
    state.webgl2 = false;

    expect(tryCreateMap({ container })).toBeNull();
    expect(state.constructed).toEqual([]);
  });

  it("returns null when the MapLibre constructor throws", () => {
    state.behaviour = "throws";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(tryCreateMap({ container })).toBeNull();
    expect(state.constructed).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
  });

  it("returns null for a half-initialised map without a painter", () => {
    state.behaviour = "no-painter";
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(tryCreateMap({ container })).toBeNull();
    expect(state.constructed).toHaveLength(1);
  });
});
