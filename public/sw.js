// Trientes web push service worker. Lives at /sw.js so it can claim the root
// scope. Two responsibilities: relay incoming push payloads to a visible
// notification, and open the relevant URL when the user clicks one.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "Trientes", body: "", url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (_) {
    // Not JSON — fall back to plain text body.
    if (event.data) payload.body = event.data.text();
  }
  const { title, body, url, tag, icon, badge } = payload;
  event.waitUntil(
    self.registration.showNotification(title || "Trientes", {
      body: body || "",
      tag: tag || undefined,
      icon: icon || "/icon.png",
      badge: badge || "/icon.png",
      data: { url: url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        // If a tab is already open at our origin, focus it and navigate.
        if ("focus" in client) {
          try {
            await client.focus();
            if ("navigate" in client) await client.navigate(target);
            return;
          } catch (_) { /* fall through */ }
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
