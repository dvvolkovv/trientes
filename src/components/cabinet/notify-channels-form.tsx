"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { updateNotifyChannels } from "@/app/actions/price-alerts";

type WebPushState =
  | "loading"
  | "unsupported"   // no service worker / push API
  | "denied"        // permission already denied at browser level
  | "off"           // supported, not subscribed in this browser
  | "on";           // supported + subscribed in this browser

// Web Push public key is exposed to the client at build time.
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf;
}

export function NotifyChannelsForm({
  notifyTelegram,
  notifyEmail,
  hasEmail,
  emailVerified,
  hasTelegramLinked,
}: {
  notifyTelegram: boolean;
  notifyEmail: boolean;
  hasEmail: boolean;
  emailVerified: boolean;
  hasTelegramLinked: boolean;
}) {
  const t = useTranslations("cabinet.alerts.channels");
  const router = useRouter();
  const [tg, setTg] = useState(notifyTelegram);
  const [em, setEm] = useState(notifyEmail);
  const [pending, startTransition] = useTransition();

  const [pushState, setPushState] = useState<WebPushState>("loading");
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined") return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !VAPID_PUBLIC) {
        if (!cancelled) setPushState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setPushState("denied");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js")
          ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setPushState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setPushState("unsupported");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function commit(next: { tg?: boolean; em?: boolean }) {
    const newTg = next.tg ?? tg;
    const newEm = next.em ?? em;
    setTg(newTg);
    setEm(newEm);
    startTransition(async () => {
      await updateNotifyChannels({ notifyTelegram: newTg, notifyEmail: newEm });
      router.refresh();
    });
  }

  async function togglePush(on: boolean) {
    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      if (on) {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          setPushState(perm === "denied" ? "denied" : "off");
          return;
        }
        // PushManager wants BufferSource; modern lib types reject the wider
        // Uint8Array<ArrayBufferLike>, so hand it the underlying ArrayBuffer.
        const keyBuf = urlBase64ToUint8Array(VAPID_PUBLIC).buffer as ArrayBuffer;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBuf,
        });
        const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
          }),
        });
        setPushState("on");
      } else {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          await sub.unsubscribe();
        }
        setPushState("off");
      }
      router.refresh();
    } catch {
      // surface nothing — the toggle just snaps back to its previous state
    } finally {
      setPushBusy(false);
    }
  }

  const pushDisabled = pushBusy || pushState === "loading" || pushState === "unsupported" || pushState === "denied";
  const pushChecked = pushState === "on";

  return (
    <div className="border border-hairline rounded-[16px] p-4 bg-card space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">{t("title")}</h3>

      <label className="flex items-center justify-between gap-3 text-sm">
        <div className="min-w-0">
          <div>{t("telegram")}</div>
          {!hasTelegramLinked ? (
            <p className="text-[11px] text-yellow-500 mt-0.5">{t("telegramNotLinked")}</p>
          ) : null}
        </div>
        <input
          type="checkbox"
          checked={tg}
          disabled={pending || !hasTelegramLinked}
          onChange={(e) => commit({ tg: e.target.checked })}
          className="h-4 w-4"
        />
      </label>

      <label className="flex items-center justify-between gap-3 text-sm">
        <div className="min-w-0">
          <div>{t("email")}</div>
          {!hasEmail ? (
            <p className="text-[11px] text-yellow-500 mt-0.5">{t("emailNotSet")}</p>
          ) : !emailVerified ? (
            <p className="text-[11px] text-yellow-500 mt-0.5">{t("emailNotVerified")}</p>
          ) : null}
        </div>
        <input
          type="checkbox"
          checked={em}
          disabled={pending || !hasEmail || !emailVerified}
          onChange={(e) => commit({ em: e.target.checked })}
          className="h-4 w-4"
        />
      </label>

      <label className="flex items-center justify-between gap-3 text-sm">
        <div className="min-w-0">
          <div>{t("webpush")}</div>
          {pushState === "unsupported" ? (
            <p className="text-[11px] text-yellow-500 mt-0.5">{t("webpushUnsupported")}</p>
          ) : pushState === "denied" ? (
            <p className="text-[11px] text-yellow-500 mt-0.5">{t("webpushDenied")}</p>
          ) : null}
        </div>
        <input
          type="checkbox"
          checked={pushChecked}
          disabled={pushDisabled}
          onChange={(e) => void togglePush(e.target.checked)}
          className="h-4 w-4"
        />
      </label>
    </div>
  );
}
