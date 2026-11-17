"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

const fieldCls =
  "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none";

const MIN_PASSWORD = 8;

export function ResetPasswordForm({ locale, token }: { locale: string; token: string }) {
  const t = useTranslations("reset");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        // Повтор сверяем здесь: ссылка одноразовая, и сжигать её из-за
        // опечатки во втором поле было бы жестоко.
        if (password !== confirm) {
          setError("password_mismatch");
          return;
        }
        if (password.length < MIN_PASSWORD) {
          setError("password_too_short");
          return;
        }
        start(async () => {
          const res = await fetch("/api/auth/password/reset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, password, locale }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            ok?: boolean;
            redirect?: string;
            error?: string;
          };
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
        <span className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("newPassword")}</span>
        <input
          className={fieldCls}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("confirmPassword")}</span>
        <input
          className={fieldCls}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </label>
      <p className="text-xs text-muted">{t("passwordHint")}</p>
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
        {pending ? t("submitting") : t("submit")}
      </button>
      <p className="text-xs text-muted text-center">
        <a href={`/${locale}/forgot-password`} className="underline">{t("requestAgain")}</a>
      </p>
    </form>
  );
}
