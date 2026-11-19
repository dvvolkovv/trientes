"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { setFollowMuted, setPromoNotifications, unfollowCompany } from "@/app/actions/company-follow";

type Row = { companyId: string; name: string; muted: boolean; live: boolean };

/**
 * Два разных отключения, и они разной силы: общий выключатель человека старше отключения
 * по магазину. Так же они читаются политикой рассылки (`recipientGate`).
 */
export function SubscriptionsControls({
  rows,
  promosOn,
  locale,
}: {
  rows: Row[];
  promosOn: boolean;
  locale: string;
}) {
  const t = useTranslations("promos.subscriptions");
  const [on, setOn] = useState(promosOn);
  const [list, setList] = useState(rows);
  const [, start] = useTransition();

  const button = "h-12 px-4 rounded-md border border-hairline text-sm hover:border-accent disabled:opacity-50";

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            start(async () => {
              await setPromoNotifications(next);
            });
          }}
        />
        <span>{t("allSwitch")}</span>
      </label>

      {list.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((row) => (
            <li key={row.companyId} className="border border-hairline rounded-md px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                {row.live ? (
                  <a href={`/${locale}/companies/${row.companyId}`} className="text-sm font-medium underline">
                    {row.name}
                  </a>
                ) : (
                  <span className="text-sm font-medium">{row.name}</span>
                )}
                <div className="text-[11px] text-muted">
                  {row.muted ? t("muted") : t("receiving")}
                  {row.live ? "" : ` · ${t("notLive")}`}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={button}
                  onClick={() =>
                    start(async () => {
                      const next = !row.muted;
                      const r = await setFollowMuted(row.companyId, next);
                      if (r.ok) {
                        setList((prev) =>
                          prev.map((x) => (x.companyId === row.companyId ? { ...x, muted: next } : x)),
                        );
                      }
                    })
                  }
                >
                  {row.muted ? t("unmute") : t("mute")}
                </button>
                <button
                  type="button"
                  className={button}
                  onClick={() =>
                    start(async () => {
                      const r = await unfollowCompany(row.companyId);
                      if (r.ok) setList((prev) => prev.filter((x) => x.companyId !== row.companyId));
                    })
                  }
                >
                  {t("unfollow")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
