import { afterEach, describe, expect, it, vi } from "vitest";
import { supportsWebGL2 } from "@/lib/webgl-support";

function stubCanvas(getContext: (type: string) => unknown) {
  const canvas = { getContext: vi.fn(getContext) };
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
  return canvas;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("supportsWebGL2", () => {
  it("returns false during SSR, when there is no window or document", () => {
    expect(typeof window).toBe("undefined");
    expect(supportsWebGL2()).toBe(false);
  });

  it("returns true and releases the probe context when WebGL2 is available", () => {
    const loseContext = vi.fn();
    const canvas = stubCanvas((type) =>
      type === "webgl2"
        ? { getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null) }
        : null,
    );

    expect(supportsWebGL2()).toBe(true);
    expect(canvas.getContext).toHaveBeenCalledWith("webgl2");
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("returns true when the probe context cannot be released explicitly", () => {
    stubCanvas((type) => (type === "webgl2" ? { getExtension: () => null } : null));

    expect(supportsWebGL2()).toBe(true);
  });

  it("returns false when the browser cannot create a WebGL2 context", () => {
    stubCanvas(() => null);

    expect(supportsWebGL2()).toBe(false);
  });

  it("does not treat WebGL1 as enough for MapLibre GL 6", () => {
    const canvas = stubCanvas((type) => (type === "webgl" || type === "experimental-webgl" ? {} : null));

    expect(supportsWebGL2()).toBe(false);
    expect(canvas.getContext).toHaveBeenCalledWith("webgl2");
  });

  it("returns false when context creation throws", () => {
    stubCanvas(() => {
      throw new Error("blocked by policy");
    });

    expect(supportsWebGL2()).toBe(false);
  });
});
