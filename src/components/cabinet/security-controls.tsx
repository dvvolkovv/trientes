"use client";

/**
 * Две кнопки раздела «Безопасность», которым нужен браузер: снять себе второй
 * фактор и закрыть остальные сеансы. Остальное в разделе — чтение, его рисует
 * сервер.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { disableOwnMfa } from "@/app/actions/mfa";
import { signOutOtherSessions } from "@/app/actions/account";

const BTN =
  "flex h-12 w-full items-center justify-center rounded-[14px] border border-hairline bg-card-alt px-4 text-sm font-semibold transition-colors hover:border-accent/60 disabled:opacity-40 sm:w-fit sm:px-8";

export function DisableOwnMfaButton() {
  const t = useTranslations("cabinet.security");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        className={BTN}
        onClick={() => {
          if (!sure) {
            // Снятие фактора — не то действие, которое делают случайным нажатием:
            // второе нажатие и есть подтверждение, окна подтверждения в проекте нет.
            setSure(true);
            return;
          }
          setError(null);
          start(async () => {
            const r = await disableOwnMfa();
            if (!r.ok) {
              setError(t.has(`mfa.errors.${r.reason}`) ? t(`mfa.errors.${r.reason}`) : r.reason);
              setSure(false);
              return;
            }
            router.refresh();
          });
        }}
      >
        {sure ? t("mfa.disableSure") : t("mfa.disable")}
      </button>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
    </div>
  );
}

export function SignOutOthersButton({ others }: { others: number }) {
  const t = useTranslations("cabinet.security");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending || others === 0}
        className={BTN}
        onClick={() => {
          setMsg(null);
          start(async () => {
            const r = await signOutOtherSessions();
            setMsg(
              r.ok
                ? t("sessions.closed", { count: r.closed })
                : t.has(`mfa.errors.${r.reason}`)
                  ? t(`mfa.errors.${r.reason}`)
                  : r.reason,
            );
            router.refresh();
          });
        }}
      >
        {t("sessions.signOutOthers")}
      </button>
      {/* Кнопка гаснет, когда закрывать нечего, и говорит почему: погасшая
          кнопка без объяснения — дефект, который живой прогон ловил в BF и BG. */}
      {others === 0 ? <p className="text-[12px] text-muted">{t("sessions.aloneHere")}</p> : null}
      {msg ? <p className="text-sm text-green-500">{msg}</p> : null}
    </div>
  );
}
