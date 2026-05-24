"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  setUsername,
  updateProfile,
  changePassword,
  setPasswordFirstTime,
} from "@/app/actions/account";

const fieldCls =
  "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none";
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
    hasPassword: boolean;
  };
}) {
  const t = useTranslations("cabinet.profile");
  const [pending, start] = useTransition();
  const [username, setUsernameLocal] = useState(initial.username);
  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [phone, setPhone] = useState(initial.phone);
  const [email, setEmail] = useState(initial.email);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [usernameMsg, setUsernameMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <section id="profile" className="scroll-mt-24 flex flex-col gap-6">
      <h2 className="text-[20px] md:text-[24px] font-bold tracking-[-0.02em]">
        {t("title")}
      </h2>

      {/* Username */}
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
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
            className="self-start bg-accent text-accent-foreground rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:brightness-110 disabled:opacity-50"
          >
            {t("save")}
          </button>
        </form>
      </div>

      {/* Profile fields */}
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
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
          </label>
          {profileMsg ? (
            <p className={`sm:col-span-2 text-sm ${profileMsg.ok ? "text-green-500" : "text-red-500"}`}>{profileMsg.text}</p>
          ) : null}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="bg-accent text-accent-foreground rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:brightness-110 disabled:opacity-50"
            >
              {t("save")}
            </button>
          </div>
        </form>
      </div>

      {/* Password */}
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
        <h3 className="font-semibold mb-4">
          {initial.hasPassword ? t("changePasswordTitle") : t("setPasswordTitle")}
        </h3>
        <form
          className="flex flex-col gap-3 max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            setPwMsg(null);
            start(async () => {
              const r = initial.hasPassword
                ? await changePassword(oldPw, newPw)
                : await setPasswordFirstTime(newPw);
              setPwMsg(
                r.ok
                  ? { ok: true, text: t("passwordSaved") }
                  : { ok: false, text: t.has(`errors.${r.reason}`) ? t(`errors.${r.reason}`) : r.reason },
              );
              if (r.ok) {
                setOldPw("");
                setNewPw("");
              }
            });
          }}
        >
          {initial.hasPassword ? (
            <label>
              <span className={labelCls}>{t("currentPassword")}</span>
              <input className={fieldCls} type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required />
            </label>
          ) : null}
          <label>
            <span className={labelCls}>{t("newPassword")}</span>
            <input className={fieldCls} type="password" autoComplete="new-password" minLength={8} maxLength={200} value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
          </label>
          {pwMsg ? (
            <p className={`text-sm ${pwMsg.ok ? "text-green-500" : "text-red-500"}`}>{pwMsg.text}</p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="self-start bg-accent text-accent-foreground rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:brightness-110 disabled:opacity-50"
          >
            {initial.hasPassword ? t("changePassword") : t("setPassword")}
          </button>
        </form>
      </div>
    </section>
  );
}
