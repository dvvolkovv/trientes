"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ADMIN_BUTTON } from "@/lib/admin-ui";
import { confirmIdentity } from "@/app/actions/reauth";

/**
 * Подтверждение личности внутри сеанса (слайс CP): код второго фактора или пароль.
 *
 * Чем подтверждать — решает **сервер** (`reauthMethod`), а не догадка браузера: у
 * записи без пароля и без фактора остаётся честный путь «выйдите и войдите снова», и
 * показывать ей пустое поле пароля значило бы обещать невозможное (правило BI).
 */
export function ReauthForm({
  method,
  csrf,
  next,
}: {
  method: "code" | "password" | "signout";
  csrf: string;
  next: string;
}) {
  const t = useTranslations("reauth");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const KNOWN = new Set([
    "unauth", "csrf", "too_many_attempts", "code_required", "password_required",
    "invalid_credentials", "code_invalid", "code_reused", "rate_limited",
    "not_enrolled", "unreadable", "no_password_set",
  ]);

  if (method === "signout") {
    return (
      <div className="space-y-3">
        <p className="text-[13px] leading-snug text-muted">{t("signoutBody")}</p>
        <a href={`/api/auth/signout?callbackUrl=${encodeURIComponent(next)}`} className={ADMIN_BUTTON}>
          {t("signout")}
        </a>
      </div>
    );
  }

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await confirmIdentity(
        method === "code" ? { code: value, csrf } : { password: value, csrf },
      );
      if (!r.ok) {
        setError(KNOWN.has(r.reason) ? t(`error.${r.reason}`) : t("error.generic"));
        return;
      }
      // Возврат туда, откуда пришли: подтверждение — шаг посреди работы, а не её конец.
      window.location.href = next;
    });

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-snug text-muted">
        {t(method === "code" ? "codeBody" : "passwordBody")}
      </p>
      <label className="block space-y-1">
        <span className="text-[12.5px] text-muted">{t(method === "code" ? "codeLabel" : "passwordLabel")}</span>
        <input
          type={method === "code" ? "text" : "password"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode={method === "code" ? "numeric" : undefined}
          autoComplete={method === "code" ? "one-time-code" : "current-password"}
          data-testid="reauth-input"
          className="w-full rounded-xl border border-hairline bg-bg-tint px-3 py-2.5"
        />
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={busy || value.trim() === ""}
        data-testid="reauth-submit"
        className={`${ADMIN_BUTTON} border-accent text-accent`}
      >
        {t("confirm")}
      </button>
      {error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
