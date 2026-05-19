"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, string | number>) => void;
  }
}

export function TelegramLogin({ botUsername }: { botUsername: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", botUsername);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-userpic", "true");
    s.setAttribute("data-onauth", "onTelegramAuth(user)");
    s.setAttribute("data-request-access", "write");
    ref.current.appendChild(s);

    window.onTelegramAuth = async (user) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(user)) form.append(k, String(v));
      const resp = await fetch("/api/auth/telegram/callback", {
        method: "POST",
        body: form,
      });
      if (resp.ok) window.location.href = resp.headers.get("Location") ?? "/";
    };
    return () => {
      window.onTelegramAuth = undefined;
    };
  }, [botUsername]);

  return <div ref={ref} />;
}
