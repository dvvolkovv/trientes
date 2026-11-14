import { readFileSync } from "node:fs";
import path from "node:path";
import maplibrePackage from "maplibre-gl/package.json";
import { buildSync } from "esbuild";
import { expect, test } from "@playwright/test";
import { basemapAttribution } from "../../src/lib/basemap";

const root = process.cwd();
const baseline = process.env.MAP_ATTRIBUTION_BASELINE === "1";

function bundle(output: "main" | "worker"): string {
  if (output === "worker") {
    const result = buildSync({
      entryPoints: ["node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"],
      bundle: true,
      format: "iife",
      write: false,
    });
    return result.outputFiles[0].text;
  }

  const result = buildSync({
    stdin: {
      contents: `
        import * as maplibregl from "maplibre-gl";
        import "./src/lib/maplibre-worker";
        ${baseline ? "" : `
          import {
            MAPLIBRE_ATTRIBUTION_OPTIONS,
            addStaticMapAttribution,
          } from "./src/lib/maplibre-attribution";
          window.MapAttribution = {
            MAPLIBRE_ATTRIBUTION_OPTIONS,
            addStaticMapAttribution,
          };
        `}
        window.maplibregl = maplibregl;
      `,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    write: false,
  });
  return result.outputFiles[0].text;
}

test("remote style attribution cannot execute iframe srcdoc", async ({ page }) => {
  const pageErrors: string[] = [];
  const unexpectedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route(/^https?:\/\//, async (route) => {
    const url = route.request().url();
    if (url === "https://maps.test/malicious-style.json") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          version: 8,
          sources: {
            malicious: {
              type: "geojson",
              data: { type: "FeatureCollection", features: [] },
              attribution:
                '<iframe srcdoc="<script>parent.window.__maplibreSrcdocExecuted=(parent.window.__maplibreSrcdocExecuted||0)+1<\/script>"></iframe>',
            },
          },
          layers: [{ id: "malicious", type: "circle", source: "malicious" }],
        }),
      });
      return;
    }
    unexpectedRequests.push(url);
    await route.abort();
  });

  await page.goto("about:blank");
  await page.addStyleTag({
    content: readFileSync(
      path.join(root, "node_modules/maplibre-gl/dist/maplibre-gl.css"),
      "utf8",
    ),
  });
  await page.addScriptTag({ content: bundle("main") });
  const workerUrl = await page.evaluate((workerSource) => {
    return URL.createObjectURL(
      new Blob([workerSource], { type: "text/javascript" }),
    );
  }, bundle("worker"));

  await page.evaluate(async ({ workerUrl, baseline }) => {
    const browserWindow = window as unknown as {
      maplibregl: typeof import("maplibre-gl");
      MapAttribution?: typeof import("../../src/lib/maplibre-attribution");
      __maplibreSrcdocExecuted?: number;
      __maplibreMap?: import("maplibre-gl").Map;
      __configuredWorkerUrl?: string;
      __mapConstructorType?: string;
    };
    const { maplibregl, MapAttribution } = browserWindow;
    browserWindow.__configuredWorkerUrl = maplibregl.getWorkerUrl();
    browserWindow.__mapConstructorType = typeof maplibregl.Map;
    maplibregl.setWorkerUrl(workerUrl);
    const container = document.createElement("div");
    container.style.cssText = "width:640px;height:480px";
    document.body.appendChild(container);
    const map = new maplibregl.Map({
      container,
      style: "https://maps.test/malicious-style.json",
      center: [14.4212535, 50.0874654],
      zoom: 12,
      interactive: false,
      ...(baseline
        ? { attributionControl: { compact: false } }
        : MapAttribution!.MAPLIBRE_ATTRIBUTION_OPTIONS),
    });
    browserWindow.__maplibreMap = map;
    if (!baseline) MapAttribution!.addStaticMapAttribution(map);
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 10_000);
      map.once("style.load", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }, { workerUrl, baseline });
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const browserWindow = window as unknown as {
      __maplibreSrcdocExecuted?: number;
      __maplibreMap?: import("maplibre-gl").Map;
      __configuredWorkerUrl?: string;
      __mapConstructorType?: string;
    };
    const attributionElements = Array.from(
      document.querySelectorAll<HTMLElement>(".maplibregl-ctrl-attrib-inner"),
    );
    const attributionText = attributionElements
      .map((element) => element.textContent ?? "")
      .join(" ");
    const attributionVisible = attributionElements.some((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    });
    const attributionLinkCount = attributionElements.reduce(
      (count, element) => count + element.querySelectorAll("a").length,
      0,
    );
    browserWindow.__maplibreMap?.remove();
    return {
      srcdocExecuted: browserWindow.__maplibreSrcdocExecuted ?? 0,
      configuredWorkerUrl: browserWindow.__configuredWorkerUrl,
      mapConstructorType: browserWindow.__mapConstructorType,
      iframeCount: document.querySelectorAll("iframe").length,
      attributionText,
      attributionVisible,
      attributionLinkCount,
    };
  });
  await test.info().attach("attribution-result", {
    body: JSON.stringify({ baseline, ...result, pageErrors, unexpectedRequests }),
    contentType: "application/json",
  });

  expect(result.srcdocExecuted).toBe(0);
  expect(result.configuredWorkerUrl).toBe(
    `/maplibre/${maplibrePackage.version}/maplibre-gl-worker.mjs`,
  );
  expect(result.mapConstructorType).toBe("function");
  expect(result.iframeCount).toBe(0);
  expect(result.attributionText).toContain("© OpenStreetMap contributors");
  expect(result.attributionText).toContain(basemapAttribution());
  expect(result.attributionText).not.toContain("iframe");
  expect(result.attributionVisible).toBe(true);
  expect(result.attributionLinkCount).toBe(0);
  expect(pageErrors).toEqual([]);
  expect(unexpectedRequests).toEqual([]);
});
