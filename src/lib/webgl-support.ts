/**
 * MapLibre GL 6 renders only through WebGL2 (WebGL1 is not enough). Probe it on
 * a throwaway canvas before creating a map. SSR-safe: there is no canvas on the
 * server, so it reports `false` there and callers decide on the client.
 */
export function supportsWebGL2(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return false;
    // Free the probe context right away: browsers cap the number of live contexts.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
