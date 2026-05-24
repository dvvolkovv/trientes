// Thin wrapper around the Screen Wake Lock API. Returns null when
// unsupported (Safari < 16.4, Firefox < 126, http://). Re-acquires on
// `visibilitychange === "visible"` — Safari silently releases the lock
// when the tab is backgrounded.

export type WakeLockHandle = {
  release: () => void;
};

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  released: boolean;
  addEventListener: (event: string, listener: () => void) => void;
};

type WakeLockApi = {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
};

function getApi(): WakeLockApi | null {
  if (typeof navigator === "undefined") return null;
  const wl = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  return wl ?? null;
}

export async function acquireWakeLock(): Promise<WakeLockHandle | null> {
  const api = getApi();
  if (!api) return null;

  let sentinel: WakeLockSentinelLike | null = null;
  let released = false;

  const acquire = async () => {
    if (released) return;
    try {
      sentinel = await api.request("screen");
    } catch {
      sentinel = null;
    }
  };

  const onVisible = () => {
    if (
      document.visibilityState === "visible" &&
      (!sentinel || sentinel.released)
    ) {
      void acquire();
    }
  };

  await acquire();
  if (!sentinel) return null;

  document.addEventListener("visibilitychange", onVisible);

  return {
    release: () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisible);
      sentinel?.release().catch(() => {});
      sentinel = null;
    },
  };
}
