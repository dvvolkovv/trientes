"use client";

/** Код из приложения при входе в админку, и код восстановления вместо него. */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ADMIN_BUTTON, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";
import { useMfaRecoveryCode, verifyMfaCode } from "@/app/actions/mfa";

const fieldCls =
  "w-full bg-card border border-hairline rounded-md px-3 py-2 text-base tracking-[0.3em] text-center placeholder:text-muted focus:ring-1 focus:ring-accent outline-none";

export function MfaVerifyForm({ locale, next }: { locale: string; next?: string }) {
  const t = useTranslations("mfa");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = recovery ? await useMfaRecoveryCode(code) : await verifyMfaCode(code);
          if (r.ok) {
            router.push(next ?? `/${locale}/admin`);
            router.refresh();
            return;
          }
          setError(r.reason);
          setCode("");
        });
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-[12px] uppercase tracking-[0.15em] text-muted">
          {recovery ? t("recoveryLabel") : t("codeLabel")}
        </span>
        <input
          className={fieldCls}
          inputMode={recovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          maxLength={recovery ? 20 : 7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
      </label>

      {error ? <p className="text-sm text-red-500">{t(`error.${error}`)}</p> : null}

      <button type="submit" className={ADMIN_BUTTON} disabled={pending}>
        {pending ? t("checking") : t("enter")}
      </button>
      <button
        type="button"
        className={ADMIN_BUTTON_SECONDARY}
        onClick={() => {
          setRecovery(!recovery);
          setCode("");
          setError(null);
        }}
      >
        {recovery ? t("useAppCode") : t("useRecovery")}
      </button>
    </form>
  );
}
