"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { setFollowMuted, setPromoNotifications, unfollowCompany } from "@/app/actions/company-follow";
import { ADMIN_BUTTON_SECONDARY, ADMIN_TILE_CENTERED } from "@/lib/admin-ui";
import { TILE_GRID } from "@/components/cabinet/cabinet-tile";
import { logoBoxClass, logoImageClass } from "@/lib/company-logo";

type Row = {
  companyId: string;
  name: string;
  legalName: string | null;
  logoUrl: string | null;
  logoShape: string | null;
  logoFit: string | null;
  muted: boolean;
  live: boolean;
  /** Кадр первого идущего материала (слайс BZ): баннер магазина, а не только знак. */
  banner: { adId: string; preview: string; title: string } | null;
};

/**
 * Два разных отключения, и они разной силы: общий выключатель человека старше
 * отключения по магазину. Так же они читаются политикой рассылки (`recipientGate`).
 *
 * Слайс BX. Магазин нарисован **той же плиткой**, какой его видит собственный
 * владелец в своём кабинете (`companies-section.tsx`): знак, имя, лицо. Прежде это
 * была подчёркнутая ссылка в рамке, и человек не узнавал магазин в лицо. Вид
 * берётся из общих `ADMIN_TILE_CENTERED` и `logoBoxClass` — своей копии правил
 * вида не заводим, иначе две витрины одного предприятия разойдутся (уборка AU).
 *
 * Нажатие ведёт на витрину предприятия — ту же страницу, что видит владелец.
 * Второго вида витрины «для подписчика» не делаем: расхождение двух видов однажды
 * стало бы расхождением данных.
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

  return (
    <div className="space-y-5">
      {/* Общий выключатель — кнопка под палец, а не голый флажок браузера: это
          решение человека о всей почте, и нажимать его он будет с телефона. */}
      <button
        type="button"
        aria-pressed={on}
        onClick={() => {
          const next = !on;
          setOn(next);
          start(async () => {
            await setPromoNotifications(next);
          });
        }}
        className={`flex min-h-[48px] w-full items-center justify-between gap-3 rounded-[14px] border px-4 text-left text-[13px] transition-colors ${
          on ? "border-accent bg-accent/10" : "border-hairline bg-bg-tint text-muted"
        }`}
      >
        <span>{t("allSwitch")}</span>
        <span className="shrink-0 text-[11px] uppercase tracking-wider">
          {on ? t("switchOn") : t("switchOff")}
        </span>
      </button>

      {list.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <div className={TILE_GRID}>
          {list.map((row) => (
            <div key={row.companyId} className="space-y-2">
              {/* Баннер подписанного магазина: владелец сказал, что в подписках его
                  не видно вовсе. Нажатие ведёт на страницу материала (BZ). */}
              {row.live && row.banner ? (
                <a href={`/${locale}/ad/${row.banner.adId}`} className="block" aria-label={row.banner.title}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={row.banner.preview}
                    alt={row.banner.title}
                    className="aspect-[16/10] w-full rounded-[16px] border border-hairline object-cover"
                  />
                </a>
              ) : null}
              <TileShell row={row} locale={locale} mutedLabel={row.muted ? t("muted") : t("receiving")} notLive={t("notLive")} />
              <div className="grid gap-2">
                <button
                  type="button"
                  className={`${ADMIN_BUTTON_SECONDARY} h-11 text-[13px]`}
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
                  className={`${ADMIN_BUTTON_SECONDARY} h-11 text-[13px]`}
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Плитка магазина. Снятое надзором или ещё не залистованное предприятие витрины не
 * имеет — тогда это не ссылка, а та же плитка без перехода: человек подписывался
 * сам и должен видеть, на что подписан, даже когда страницы нет.
 */
function TileShell({
  row,
  locale,
  mutedLabel,
  notLive,
}: {
  row: Row;
  locale: string;
  mutedLabel: string;
  notLive: string;
}) {
  const inner = (
    <>
      <div className={`${logoBoxClass(row.logoShape)} h-12 w-12`}>
        {row.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.logoUrl} alt="" className={logoImageClass(row.logoFit)} />
        ) : (
          <span className="text-lg" aria-hidden>🏢</span>
        )}
      </div>
      <div className="mt-2 min-w-0 w-full text-center">
        <div className="truncate text-[14px] font-semibold leading-tight">{row.name}</div>
        {row.legalName ? <div className="truncate text-[11px] text-muted">{row.legalName}</div> : null}
      </div>
      <div className="mt-1.5 text-center text-[11px] text-muted">
        {mutedLabel}
        {row.live ? "" : ` · ${notLive}`}
      </div>
    </>
  );
  if (!row.live) return <div className={ADMIN_TILE_CENTERED}>{inner}</div>;
  return (
    <a
      href={`/${locale}/companies/${row.companyId}`}
      className={`${ADMIN_TILE_CENTERED} transition-colors hover:border-accent/60`}
    >
      {inner}
    </a>
  );
}
