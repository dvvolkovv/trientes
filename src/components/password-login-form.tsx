"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

const fieldCls =
  "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none";

export function PasswordLoginForm({ locale, next }: { locale: string; next?: string }) {
  const t = useTranslations("register");
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await fetch("/api/auth/password/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier, password, locale, next }),
          });
          const data = (await res.json().catch(() => ({}))) as { ok?: boolean; redirect?: string; error?: string };
          if (res.ok && data.redirect) {
            router.push(data.redirect);
            router.refresh();
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
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("password")}</span>
        <input
          className={fieldCls}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error ? (
        <p className="text-sm text-red-500">{t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.unknown_error")}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-accent-foreground rounded-full px-4 py-2.5 text-sm font-semibold uppercase tracking-wider hover:brightness-110 transition-all disabled:opacity-50"
      >
        {pending ? t("submitting") : t("signIn")}
      </button>
      <p className="text-xs text-muted text-center">
        {t("noAccount")}{" "}
        <a href={`/${locale}/register`} className="underline">{t("createAccount")}</a>
      </p>
    </form>
  );
}
