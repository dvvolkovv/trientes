import type { IControl, Map as MlMap } from "maplibre-gl";
import { basemapAttribution } from "./basemap";

export const MAPLIBRE_ATTRIBUTION_OPTIONS = {
  attributionControl: false,
} as const;

const STATIC_MAP_ATTRIBUTION = [
  basemapAttribution(),
  "© Esri, Maxar, Earthstar Geographics", // satellite layer
].join(" | ");

class StaticMapAttributionControl implements IControl {
  private container: HTMLDivElement | undefined;

  onAdd(): HTMLElement {
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-attrib";

    const inner = document.createElement("div");
    inner.className = "maplibregl-ctrl-attrib-inner";
    inner.textContent = STATIC_MAP_ATTRIBUTION;
    container.appendChild(inner);

    this.container = container;
    return container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = undefined;
  }
}

/** Remote style/source attribution is untrusted HTML; render only this fixed text. */
export function addStaticMapAttribution(map: MlMap): void {
  map.addControl(new StaticMapAttributionControl(), "bottom-right");
}
