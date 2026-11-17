"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

const fieldCls =
  "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none";

export function ForgotPasswordForm({ locale }: { locale: string }) {
  const t = useTranslations("reset");
  const [identifier, setIdentifier] = useState("");
  // Что именно ушло на сервер. Ответ одинаков и для нашего ящика, и для
  // чужого, поэтому единственное, что спасает от опечатки, — показать
  // человеку набранное обратно.
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (sent) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold">{t("sentTitle")}</p>
        <p className="text-sm text-muted">
          {t("sentBody", { identifier: sent })}
        </p>
        <p className="num text-sm font-semibold break-all bg-card-alt border border-hairline rounded-md px-3 py-2">
          {sent}
        </p>
        <p className="text-xs text-muted">{t("sentTypo", { identifier: sent })}</p>
        <p className="text-xs text-muted">{t("sentHint")}</p>
        <button
          type="button"
          onClick={() => setSent(null)}
          className="self-start text-accent text-sm font-medium underline"
        >
          {t("tryAgain")}
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const asked = identifier.trim();
        start(async () => {
          const res = await fetch("/api/auth/password/forgot", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier: asked, locale }),
          });
          const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
          if (res.ok && data.ok) {
            setSent(asked);
            return;
          }
          setError(data.error ?? "unknown_error");
        });
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("identifier")}</span>
        <input
          className={fieldCls}
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
        />
      </label>
      {error ? (
        <p className="text-sm text-red-500">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.unknown_error")}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-accent-foreground rounded-full px-4 py-2.5 text-sm font-semibold uppercase tracking-wider hover:brightness-110 transition-all disabled:opacity-50"
      >
        {pending ? t("sending") : t("send")}
      </button>
      <p className="text-xs text-muted text-center">
        <a href={`/${locale}/login`} className="underline">{t("backToLogin")}</a>
      </p>
    </form>
  );
}
