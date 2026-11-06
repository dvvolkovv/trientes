"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { labelCls } from "./field";

/**
 * Logo is uploaded through a route handler rather than a server action: the
 * file goes straight to disk, same as point photos and KYB documents.
 */
export function LogoUpload({
  cardId,
  onUploaded,
}: {
  cardId: string;
  onUploaded: (url: string) => void;
}) {
  const t = useTranslations("coinCard.wizard");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div>
      <span className={labelCls}>{t("logo")}</span>
      <div className="flex items-center gap-4">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" width={48} height={48}
            className="rounded-full border border-hairline" />
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={pending}
          className="text-sm text-muted"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setError(null);
            start(async () => {
              const fd = new FormData();
              fd.set("cardId", cardId);
              fd.set("file", file);
              const res = await fetch("/api/coin-card/logo/upload", { method: "POST", body: fd });
              const json = (await res.json().catch(() => null)) as
                | { ok?: boolean; url?: string; error?: string }
                | null;
              if (json?.ok && json.url) {
                setUrl(json.url);
                onUploaded(json.url);
              } else {
                setError(json?.error ?? "unknown_error");
              }
            });
          }}
        />
      </div>
      <p className="text-muted text-xs mt-1">{t("logoHint")}</p>
      {error && <p className="text-down text-sm mt-1">{t(`errors.${error}`)}</p>}
    </div>
  );
}
