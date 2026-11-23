"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { moveAd, setAdStatus, submitAd, withdrawAd } from "@/app/actions/company-ads";
import { MAX_PUBLISHED_ADS } from "@/lib/ads/rules";
import { adSubmittable, adWithdrawable, type AdStatus } from "@/lib/ads/moderation";

export type AdRow = {
  id: string;
  kind: string;
  title: string;
  status: AdStatus;
  mediaKind: "IMAGE" | "VIDEO";
  preview: string;
  window: string | null;
  hasAudio: boolean;
  /** Ждёт ли решения правка опубликованного материала (слайс CC). */
  hasPending: boolean;
  /** Причина отказа модератора: её читает продавец, и молчать о ней нельзя. */
  rejectionReason: string | null;
  /** Место в карусели — ради него и нужны «выше»/«ниже». */
  position?: number;
};

const STATUS_CLASS: Record<AdStatus, string> = {
  PUBLISHED: "bg-[#30B658]/15 text-[#30B658]",
  PENDING: "bg-accent/15 text-accent",
  REJECTED: "bg-[#E55C5C]/15 text-[#E55C5C]",
  ARCHIVED: "bg-card-alt text-muted",
  DRAFT: "bg-card-alt text-muted-strong",
};

/**
 * Список материалов: что сейчас в карусели, что ждёт модератора, что лежит
 * черновиком и что отвергнуто — с причиной.
 *
 * Публикует модератор (слайс CC), поэтому кнопки «Опубликовать» здесь нет вовсе:
 * кнопка, которую действие всё равно отвергает, хуже её отсутствия (правило BI).
 */
export function AdList({
  ads,
  editable,
  basePath,
  adBasePath,
}: {
  ads: AdRow[];
  editable: boolean;
  basePath: string;
  /**
   * Корень страниц материала: оттуда его смотрят и слушают до публикации (CB).
   * Строкой, а не функцией: функцию серверный компонент клиентскому не передаёт.
   */
  adBasePath: string;
}) {
  const t = useTranslations("cabinetAds");
  const [pending, start] = useTransition();
  // Кнопка ряда — та же, что в списке акций: высота под палец (правило AN), но не во
  // всю ширину, иначе пять действий встают пятью полосами.
  const button =
    "inline-flex h-12 items-center justify-center rounded-md border border-hairline px-4 text-sm hover:border-accent disabled:opacity-50";

  if (ads.length === 0) return <p className="text-sm text-muted">{t("empty")}</p>;

  return (
    <ul className="space-y-3">
      {ads.map((ad) => (
        <li key={ad.id} className="rounded-[18px] border border-hairline bg-card p-3">
          <div className="flex gap-3">
            <div className="h-[72px] w-[115px] shrink-0 overflow-hidden rounded-[12px] border border-hairline bg-bg-tint">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ad.preview} alt="" className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-hairline bg-bg-tint px-2 py-0.5 text-[10.5px] uppercase tracking-wider text-muted">
                  {t(`kind.${ad.kind}`)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10.5px] uppercase tracking-wider ${STATUS_CLASS[ad.status]}`}
                >
                  {t(`status.${ad.status}`)}
                </span>
                {ad.mediaKind === "VIDEO" ? <span className="text-[11px] text-muted">▶ {t("video")}</span> : null}
                {ad.hasAudio ? <span className="text-[11px] text-muted">🔊 {t("voiced")}</span> : null}
              </div>
              <div className="mt-1 truncate text-[14.5px] font-semibold">{ad.title}</div>
              {/* Место в карусели словами: голый номер «3.» не говорит, из скольких
                  и чего именно (та же жалоба, что на голые стрелки в AN). */}
              {ad.status === "PUBLISHED" && ad.position ? (
                <div className="text-[11.5px] text-accent">
                  {t("slideNo", { n: ad.position, total: MAX_PUBLISHED_ADS })}
                </div>
              ) : null}
              {ad.window ? <div className="num text-[11.5px] text-muted">{ad.window}</div> : null}
            </div>
          </div>

          {/* Ждущая правка опубликованного: в карусели по-прежнему прежний материал,
              и сказать это надо словами — иначе продавец решит, что правка пропала. */}
          {ad.hasPending ? (
            <p className="mt-2 rounded-md border border-accent/40 bg-accent/10 p-2 text-[12px] text-accent">
              {t("pendingChanges")}
            </p>
          ) : null}
          {/* Причина отказа показывается и опубликованному материалу: модератор мог
              отвергнуть **правку**, а не материал, и тогда статус остаётся
              «в карусели» — продавец иначе не узнал бы, что с его правкой. */}
          {ad.rejectionReason && !ad.hasPending ? (
            <p className="mt-2 rounded-md border border-[#E55C5C]/40 bg-[#E55C5C]/10 p-2 text-[12px] text-[#E55C5C]">
              {ad.status === "REJECTED"
                ? t("rejectedReason", { reason: ad.rejectionReason })
                : t("changesRejectedReason", { reason: ad.rejectionReason })}
            </p>
          ) : null}

          {editable ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {/* Материал на проверке не правится: модератор смотрит именно это
                  содержание (слайс CC). Кнопки правки у него нет, а не погашена. */}
              {ad.status !== "PENDING" ? (
                <Link href={`${basePath}?ad=${ad.id}`} className={button}>{t("edit")}</Link>
              ) : null}
              <Link href={`${adBasePath}/${ad.id}`} className={button}>{t("preview")}</Link>
              {adSubmittable(ad.status) ? (
                <button type="button" className={button} disabled={pending}
                  onClick={() => start(async () => { await submitAd(ad.id); })}>
                  {t("submit")}
                </button>
              ) : null}
              {adWithdrawable({ status: ad.status, hasPending: ad.hasPending }) ? (
                <button type="button" className={button} disabled={pending}
                  onClick={() => start(async () => { await withdrawAd(ad.id); })}>
                  {ad.status === "PENDING" ? t("withdraw") : t("withdrawChanges")}
                </button>
              ) : null}
              {ad.status !== "ARCHIVED" && ad.status !== "PENDING" ? (
                <button type="button" className={button} disabled={pending}
                  onClick={() => start(async () => { await setAdStatus(ad.id, "ARCHIVED"); })}>
                  {t("archive")}
                </button>
              ) : null}
              {ad.status === "PUBLISHED" ? (
                <>
                  {/* Порядок в карусели: что человек увидит первым. Голая стрелка
                      ничего не говорит — слово рядом обязательно (правило AN). */}
                  <button type="button" className={button} disabled={pending}
                    onClick={() => start(async () => { await moveAd(ad.id, "up"); })}>
                    <span aria-hidden className="mr-1.5">↑</span>{t("up")}
                  </button>
                  <button type="button" className={button} disabled={pending}
                    onClick={() => start(async () => { await moveAd(ad.id, "down"); })}>
                    <span aria-hidden className="mr-1.5">↓</span>{t("down")}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
