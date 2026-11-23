"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { moveAd, setAdStatus } from "@/app/actions/company-ads";

export type AdRow = {
  id: string;
  kind: string;
  title: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  mediaKind: "IMAGE" | "VIDEO";
  preview: string;
  window: string | null;
  hasAudio: boolean;
  /** Место в карусели — ради него и нужны «выше»/«ниже». */
  position?: number;
};

/** Список материалов: что сейчас в карусели, в каком порядке и что лежит черновиком. */
export function AdList({ ads, editable, basePath }: { ads: AdRow[]; editable: boolean; basePath: string }) {
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
                  className={`rounded-full px-2 py-0.5 text-[10.5px] uppercase tracking-wider ${
                    ad.status === "PUBLISHED"
                      ? "bg-[#30B658]/15 text-[#30B658]"
                      : ad.status === "ARCHIVED"
                        ? "bg-card-alt text-muted"
                        : "bg-accent/15 text-accent"
                  }`}
                >
                  {t(`status.${ad.status}`)}
                </span>
                {ad.mediaKind === "VIDEO" ? <span className="text-[11px] text-muted">▶ {t("video")}</span> : null}
                {ad.hasAudio ? <span className="text-[11px] text-muted">🔊 {t("voiced")}</span> : null}
              </div>
              <div className="mt-1 truncate text-[14.5px] font-semibold">
                {ad.status === "PUBLISHED" && ad.position ? (
                  <span className="num mr-1.5 text-muted">{ad.position}.</span>
                ) : null}
                {ad.title}
              </div>
              {ad.window ? <div className="num text-[11.5px] text-muted">{ad.window}</div> : null}
            </div>
          </div>

          {editable ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`${basePath}?ad=${ad.id}`} className={button}>{t("edit")}</Link>
              {ad.status !== "PUBLISHED" ? (
                <button type="button" className={button} disabled={pending}
                  onClick={() => start(async () => { await setAdStatus(ad.id, "PUBLISHED"); })}>
                  {t("publish")}
                </button>
              ) : (
                <button type="button" className={button} disabled={pending}
                  onClick={() => start(async () => { await setAdStatus(ad.id, "DRAFT"); })}>
                  {t("unpublish")}
                </button>
              )}
              {ad.status !== "ARCHIVED" ? (
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
