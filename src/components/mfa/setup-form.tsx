"use client";

/**
 * Заведение второго фактора. Ссылка `otpauth://` нажатием с телефона заводит
 * фактор в один шаг — поэтому QR в этом слайсе не рисуем; ключ буквами
 * остаётся для случая «кабинет открыт на компьютере».
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ADMIN_BUTTON, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";
import { confirmMfaEnrollment, startMfaEnrollment } from "@/app/actions/mfa";

const fieldCls =
  "w-full bg-card border border-hairline rounded-md px-3 py-2 text-base tracking-[0.3em] text-center placeholder:text-muted focus:ring-1 focus:ring-accent outline-none";

/** Ключ группами по четыре: его набирают руками с экрана. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

export function MfaSetupForm({ locale, next }: { locale: string; next?: string }) {
  const t = useTranslations("mfa");
  const router = useRouter();
  const [enroll, setEnroll] = useState<{ secretB32: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pending, start] = useTransition();

  // Ключ заводится при открытии экрана: отдельная кнопка «начать» ничего не
  // спрашивает у человека и только добавляет нажатие.
  useEffect(() => {
    let alive = true;
    void startMfaEnrollment().then((r) => {
      if (!alive) return;
      if (r.ok) setEnroll({ secretB32: r.secretB32, uri: r.uri });
      else setError(r.reason);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (codes) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t("codesIntro")}</p>
        <ul className="num grid grid-cols-2 gap-2 bg-card border border-hairline rounded-[14px] p-4 text-sm">
          {codes.map((c) => (
            <li key={c} className="tracking-[0.15em]">
              {c}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">{t("codesOnce")}</p>
        <button
          type="button"
          className={ADMIN_BUTTON}
          onClick={() => {
            router.push(next ?? `/${locale}/admin`);
            router.refresh();
          }}
        >
          {t("codesSaved")}
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await confirmMfaEnrollment(code);
          if (r.ok && "recoveryCodes" in r) {
            setCodes(r.recoveryCodes);
            return;
          }
          setError("reason" in r ? r.reason : "unknown_error");
          setCode("");
        });
      }}
    >
      <ol className="flex flex-col gap-3 text-sm text-muted">
        <li>{t("step1")}</li>
        <li>
          {enroll ? (
            <span className="flex flex-col gap-2">
              <a className={ADMIN_BUTTON_SECONDARY} href={enroll.uri}>
                {t("openApp")}
              </a>
              <span className="text-xs">{t("orByHand")}</span>
              <code className="num block bg-card border border-hairline rounded-md px-3 py-2 text-[13px] tracking-[0.2em] break-all">
                {grouped(enroll.secretB32)}
              </code>
            </span>
          ) : (
            <span className="text-xs">{t("preparing")}</span>
          )}
        </li>
        <li>{t("step3")}</li>
      </ol>

      <label className="flex flex-col gap-1">
        <span className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("codeLabel")}</span>
        <input
          className={fieldCls}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
      </label>

      {error ? <p className="text-sm text-red-500">{t(`error.${error}`)}</p> : null}

      <button type="submit" className={ADMIN_BUTTON} disabled={pending || !enroll}>
        {pending ? t("checking") : t("confirm")}
      </button>
    </form>
  );
}
