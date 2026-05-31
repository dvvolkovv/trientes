"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { updateNotifyChannels } from "@/app/actions/price-alerts";

export function NotifyChannelsForm({
  notifyTelegram,
  notifyEmail,
  hasEmail,
  emailVerified,
  hasTelegramLinked,
}: {
  notifyTelegram: boolean;
  notifyEmail: boolean;
  hasEmail: boolean;
  emailVerified: boolean;
  hasTelegramLinked: boolean;
}) {
  const t = useTranslations("cabinet.alerts.channels");
  const router = useRouter();
  const [tg, setTg] = useState(notifyTelegram);
  const [em, setEm] = useState(notifyEmail);
  const [pending, startTransition] = useTransition();

  function commit(next: { tg?: boolean; em?: boolean }) {
    const newTg = next.tg ?? tg;
    const newEm = next.em ?? em;
    setTg(newTg);
    setEm(newEm);
    startTransition(async () => {
      await updateNotifyChannels({ notifyTelegram: newTg, notifyEmail: newEm });
      router.refresh();
    });
  }

  return (
    <div className="border border-hairline rounded-[16px] p-4 bg-card space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">{t("title")}</h3>

      <label className="flex items-center justify-between gap-3 text-sm">
        <div className="min-w-0">
          <div>{t("telegram")}</div>
          {!hasTelegramLinked ? (
            <p className="text-[11px] text-yellow-500 mt-0.5">{t("telegramNotLinked")}</p>
          ) : null}
        </div>
        <input
          type="checkbox"
          checked={tg}
          disabled={pending || !hasTelegramLinked}
          onChange={(e) => commit({ tg: e.target.checked })}
          className="h-4 w-4"
        />
      </label>

      <label className="flex items-center justify-between gap-3 text-sm">
        <div className="min-w-0">
          <div>{t("email")}</div>
          {!hasEmail ? (
            <p className="text-[11px] text-yellow-500 mt-0.5">{t("emailNotSet")}</p>
          ) : !emailVerified ? (
            <p className="text-[11px] text-yellow-500 mt-0.5">{t("emailNotVerified")}</p>
          ) : null}
        </div>
        <input
          type="checkbox"
          checked={em}
          disabled={pending || !hasEmail || !emailVerified}
          onChange={(e) => commit({ em: e.target.checked })}
          className="h-4 w-4"
        />
      </label>
    </div>
  );
}
