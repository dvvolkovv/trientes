// Next.js calls register() once per server instance, before the first request.
export async function register(): Promise<void> {
  // Edge has no filesystem. Kept as a positive check with the import inside, so
  // the edge build drops the Node-only module.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { checkMapLibreAssets } = await import("@/lib/maplibre-assets");
      checkMapLibreAssets();
    } catch (error) {
      // Reporting only: a failed check must never stop the server from starting.
      // The name only, as a message may carry an absolute path.
      const name = error instanceof Error ? error.name : typeof error;
      console.error(`[instrumentation] MapLibre asset check failed: ${name}`);
    }
  }
}
