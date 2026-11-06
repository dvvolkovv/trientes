import { describe, expect, it } from "vitest";
import { parseBtcMapElements, parseBtcMapDeletedIds } from "@/lib/btcmap";

const node = {
  id: "node:9778525869",
  osm_json: {
    type: "node",
    id: 9778525869,
    lat: 42.2762511,
    lon: 42.7024218,
    tags: { "currency:XBT": "yes", name: "Green Town", tourism: "hotel" },
  },
  deleted_at: "",
};

describe("parseBtcMapElements", () => {
  it("flattens a live node, keeping its untouched OSM tags", () => {
    expect(parseBtcMapElements([node])).toEqual([
      {
        id: "node:9778525869",
        type: "node",
        osmId: "9778525869",
        lat: 42.2762511,
        lon: 42.7024218,
        tags: { "currency:XBT": "yes", name: "Green Town", tourism: "hotel" },
      },
    ]);
  });

  it("derives a way's centre from bounds (BTC Map has no Overpass `center`)", () => {
    const way = {
      id: "way:1000205469",
      osm_json: {
        type: "way",
        id: 1000205469,
        bounds: { minlat: 38.0, minlon: -94.8, maxlat: 38.2, maxlon: -94.6 },
        tags: { name: "We Buy Gold", "currency:XBT": "yes" },
      },
      deleted_at: "",
    };
    const [row] = parseBtcMapElements([way]);
    expect(row.lat).toBeCloseTo(38.1);
    expect(row.lon).toBeCloseTo(-94.7);
    expect(row.type).toBe("way");
  });

  it("drops deleted places", () => {
    expect(parseBtcMapElements([{ ...node, deleted_at: "2024-03-01T00:00:00Z" }])).toEqual([]);
  });

  it("drops elements with no coordinates, no tags, or no id", () => {
    expect(
      parseBtcMapElements([
        { id: "node:1", osm_json: { type: "node", id: 1, tags: { name: "X" } }, deleted_at: "" },
        { id: "node:2", osm_json: { type: "node", id: 2, lat: 1, lon: 1, tags: {} }, deleted_at: "" },
        { id: "node:3", osm_json: { type: "node", lat: 1, lon: 1, tags: { name: "Y" } }, deleted_at: "" },
      ]),
    ).toEqual([]);
  });

  it("rejects out-of-range coordinates", () => {
    const bad = { ...node, osm_json: { ...node.osm_json, lat: 99, lon: 200 } };
    expect(parseBtcMapElements([bad])).toEqual([]);
  });

  it("returns [] for a non-array payload", () => {
    expect(parseBtcMapElements(null)).toEqual([]);
    expect(parseBtcMapElements({ elements: [node] })).toEqual([]);
  });
});

describe("parseBtcMapDeletedIds", () => {
  it("collects only the ids marked deleted", () => {
    const raw = [node, { id: "node:42", deleted_at: "2024-03-01T00:00:00Z" }, { id: "node:7", deleted_at: null }];
    expect(parseBtcMapDeletedIds(raw)).toEqual(["node:42"]);
  });
});
