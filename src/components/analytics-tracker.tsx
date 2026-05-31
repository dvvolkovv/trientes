"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Fires a single page view per navigation. Runs only in the browser, only
// when the URL actually changes, and only for non-prerendered renders.
export function AnalyticsTracker({ locale }: { locale: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Strip the search params from the path we send — query strings would
    // explode our cardinality without adding much insight. Aggregation in the
    // dashboard works on the path alone.
    const ref = document.referrer || null;
    const payload = JSON.stringify({ path: pathname, referrer: ref, locale });
    // navigator.sendBeacon is best-effort and survives navigation, but only
    // accepts Blob/FormData. Use fetch with keepalive as a portable fallback.
    try {
      const blob = new Blob([payload], { type: "application/json" });
      if (!navigator.sendBeacon?.("/api/track", blob)) {
        void fetch("/api/track", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
          keepalive: true,
        });
      }
    } catch {
      void fetch("/api/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
    // searchParams is intentionally NOT in the deps array — we don't want a
    // hit per ?page=2 navigation; pathname is the unique identifier for a
    // logical page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Ensure searchParams is referenced so Next.js wraps the client subtree
  // in <Suspense>, which the App Router requires for components that read it.
  void searchParams;
  return null;
}
