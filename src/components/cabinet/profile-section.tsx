"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { setUsername, updateProfile } from "@/app/actions/account";
import { requestEmailVerification } from "@/app/actions/email-verify";
import { useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";

const fieldCls =
  "w-full bg-card-alt border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none";
const labelCls = "text-[12px] uppercase tracking-[0.15em] text-muted mb-1 block";

export function ProfileSection({
  initial,
}: {
  initial: {
    username: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    emailVerified: boolean;
  };
}) {
  const t = useTranslations("cabinet.profile");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const verifyResult = searchParams.get("verify");
  const [pending, start] = useTransition();
  const [verifyMsg, setVerifyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSendVerification() {
    setVerifyMsg(null);
    start(async () => {
      const r = await requestEmailVerification({ locale });
      if (r.ok) setVerifyMsg({ ok: true, text: t("emailVerify.sent") });
      else setVerifyMsg({ ok: false, text: t(`emailVerify.errors.${r.reason}`) });
    });
  }
  const [username, setUsernameLocal] = useState(initial.username);
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [phone, setPhone] = useState(initial.phone);
  const [email, setEmail] = useState(initial.email);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [usernameMsg, setUsernameMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <section id="profile" className="scroll-mt-24 flex flex-col gap-4">
      {/* Имя, телефон, почта — главное, поэтому первым. */}
      <div className="rounded-[20px] border border-hairline bg-card p-6 md:p-8">
        <h3 className="font-semibold mb-4">{t("contactTitle")}</h3>
        <form
          className="grid sm:grid-cols-2 gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setProfileMsg(null);
            start(async () => {
              const r = await updateProfile({ firstName, lastName, phone, email });
              setProfileMsg(
                r.ok
                  ? { ok: true, text: t("saved") }
                  : { ok: false, text: t.has(`errors.${r.reason}`) ? t(`errors.${r.reason}`) : r.reason },
              );
            });
          }}
        >
          <label>
            <span className={labelCls}>{t("firstName")}</span>
            <input className={fieldCls} value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={80} />
          </label>
          <label>
            <span className={labelCls}>{t("lastName")}</span>
            <input className={fieldCls} value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={80} />
          </label>
          <label>
            <span className={labelCls}>{t("phone")}</span>
            <input className={fieldCls} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
          </label>
          <label>
            <span className={labelCls}>{t("email")}</span>
            <input className={fieldCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
            {email ? (
              <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                {initial.emailVerified ? (
                  <span className="text-green-500">✓ {t("emailVerify.verified")}</span>
                ) : (
                  <>
                    <span className="text-yellow-500">⚠ {t("emailVerify.notVerified")}</span>
                    <button
                      type="button"
                      onClick={onSendVerification}
                      disabled={pending}
                      className="text-accent underline disabled:opacity-50"
                    >
                      {t("emailVerify.send")}
                    </button>
                  </>
                )}
                {verifyResult === "ok" && !verifyMsg ? (
                  <span className="text-green-500">{t("emailVerify.success")}</span>
                ) : null}
                {verifyResult === "expired" && !verifyMsg ? (
                  <span className="text-red-500">{t("emailVerify.errors.expired")}</span>
                ) : null}
                {verifyResult === "invalid" && !verifyMsg ? (
                  <span className="text-red-500">{t("emailVerify.errors.invalid")}</span>
                ) : null}
                {verifyMsg ? (
                  <span className={verifyMsg.ok ? "text-green-500" : "text-red-500"}>
                    {verifyMsg.text}
                  </span>
                ) : null}
              </div>
            ) : null}
          </label>
          {profileMsg ? (
            <p className={`sm:col-span-2 text-sm ${profileMsg.ok ? "text-green-500" : "text-red-500"}`}>{profileMsg.text}</p>
          ) : null}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="flex h-12 items-center justify-center rounded-[14px] bg-accent px-6 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {t("save")}
            </button>
          </div>
        </form>
      </div>

      {/* Имя входа: единственное, что люди видят наружу. */}
      <div className="rounded-[20px] border border-hairline bg-card p-6 md:p-8">
        <h3 className="font-semibold mb-4">{t("usernameTitle")}</h3>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setUsernameMsg(null);
            start(async () => {
              const r = await setUsername(username);
              setUsernameMsg(
                r.ok
                  ? { ok: true, text: t("saved") }
                  : { ok: false, text: t.has(`errors.${r.reason}`) ? t(`errors.${r.reason}`) : r.reason },
              );
            });
          }}
        >
          <label>
            <span className={labelCls}>{t("username")}</span>
            <input
              className={fieldCls}
              value={username}
              onChange={(e) => setUsernameLocal(e.target.value)}
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_]+"
              required
            />
          </label>
          {usernameMsg ? (
            <p className={`text-sm ${usernameMsg.ok ? "text-green-500" : "text-red-500"}`}>{usernameMsg.text}</p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="flex h-12 items-center justify-center self-start rounded-[14px] bg-accent px-6 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {t("save")}
          </button>
        </form>
      </div>
    </section>
  );
}
