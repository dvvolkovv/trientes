import { afterEach, describe, expect, it, vi } from "vitest";

const checkMapLibreAssets = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/lib/maplibre-assets", () => ({ checkMapLibreAssets }));

import { register } from "../src/instrumentation";

afterEach(() => {
  vi.unstubAllEnvs();
  checkMapLibreAssets.mockReset();
  checkMapLibreAssets.mockImplementation(() => true);
});

describe("instrumentation register()", () => {
  it("checks the MapLibre assets in the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await register();
    expect(checkMapLibreAssets).toHaveBeenCalledTimes(1);
  });

  it("skips the check in the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();
    expect(checkMapLibreAssets).not.toHaveBeenCalled();
  });

  it("never fails server startup when the check throws", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    checkMapLibreAssets.mockImplementation(() => {
      throw new Error("/absolute/secret/path");
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(register()).resolves.toBeUndefined();
      expect(errors).toHaveBeenCalledTimes(1);
      expect(errors.mock.calls[0].join(" ")).not.toContain("/absolute/secret/path");
    } finally {
      errors.mockRestore();
    }
  });
});
