import { setWorkerUrl } from "maplibre-gl";
import maplibrePackage from "maplibre-gl/package.json";

export const MAPLIBRE_WORKER_URL = `/maplibre/${maplibrePackage.version}/maplibre-gl-worker.mjs`;

setWorkerUrl(MAPLIBRE_WORKER_URL);
