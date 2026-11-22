"use client";

/** Пароль: смена и первая установка. Переехало из «Профиля» в «Безопасность» (BT). */

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { changePassword, setPasswordFirstTime } from "@/app/actions/account";

const fieldCls =
  "w-full bg-card-alt border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none";
const labelCls = "text-[12px] uppercase tracking-[0.15em] text-muted mb-1 block";

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const t = useTranslations("cabinet.profile");
  const [pending, start] = useTransition();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className="flex max-w-md flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        start(async () => {
          const r = hasPassword
            ? await changePassword(oldPw, newPw)
            : await setPasswordFirstTime(newPw);
          setMsg(
            r.ok
              ? { ok: true, text: t("passwordSaved") }
              : {
                  ok: false,
                  text: t.has(`errors.${r.reason}`) ? t(`errors.${r.reason}`) : r.reason,
                },
          );
          if (r.ok) {
            setOldPw("");
            setNewPw("");
          }
        });
      }}
    >
      {hasPassword ? (
        <label>
          <span className={labelCls}>{t("currentPassword")}</span>
          <input
            className={fieldCls}
            type="password"
            autoComplete="current-password"
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
            required
          />
        </label>
      ) : null}
      <label>
        <span className={labelCls}>{t("newPassword")}</span>
        <input
          className={fieldCls}
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={200}
          value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
          required
        />
      </label>
      {msg ? (
        <p className={`text-sm ${msg.ok ? "text-green-500" : "text-red-500"}`}>{msg.text}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="flex h-12 items-center justify-center rounded-[14px] bg-accent px-6 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {hasPassword ? t("changePassword") : t("setPassword")}
      </button>
    </form>
  );
}
