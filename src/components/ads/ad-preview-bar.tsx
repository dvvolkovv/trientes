"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { submitAd, withdrawAd } from "@/app/actions/company-ads";
import { adSubmittable, adWithdrawable, type AdStatus } from "@/lib/ads/moderation";

/**
 * Полоса предпросмотра (слайс CB). Материал снаружи ещё не виден, а эту страницу
 * открыл тот, кто его ведёт: показываем всё ровно так, как увидит покупатель, —
 * но плашкой говорим, в каком он состоянии.
 *
 * Публиковать отсюда больше нельзя (слайс CC): публикует модератор. Зато отправить
 * на проверку можно прямо здесь — человек пришёл посмотреть и послушать перед тем,
 * как выкладывать, и возвращать его списком за той же кнопкой это лишний шаг там,
 * где решение уже принято.
 */
export function AdPreviewBar({
  status,
  hasPending,
  canManage,
  rejectionReason,
  adId,
  studioHref,
}: {
  status: AdStatus;
  /** Ждёт ли решения правка опубликованного материала. */
  hasPending: boolean;
  /** Право `promos` на правку: отправить и отозвать. */
  canManage: boolean;
  rejectionReason: string | null;
  adId: string;
  studioHref: string;
}) {
  const t = useTranslations("adPage");
  const router = useRouter();
  const [pending, start] = useTransition();

  const button =
    "flex h-12 items-center justify-center rounded-[14px] border border-hairline bg-card-alt px-4 text-[13px] font-semibold disabled:opacity-50";
  const primary =
    "flex h-12 items-center justify-center rounded-[14px] bg-accent px-4 text-[13px] font-bold text-accent-foreground disabled:opacity-50";

  const headline =
    status === "PENDING"
      ? t("preview.onReview")
      : status === "REJECTED"
        ? t("preview.rejected")
        : status === "ARCHIVED"
          ? t("preview.archived")
          : hasPending
            ? t("preview.changesOnReview")
            : t("preview.draft");

  return (
    <section className="rounded-[18px] border border-dashed border-accent/60 bg-accent/8 p-3">
      <p className="text-[13px] font-semibold text-accent">{headline}</p>
      <p className="mt-1 text-[12px] text-muted">{t("preview.hint")}</p>
      {/* Причину отказа читает тот, кто будет править: молчать о ней значит
          отправить человека гадать, что не так. */}
      {status === "REJECTED" && rejectionReason ? (
        <p className="mt-2 rounded-md border border-[#E55C5C]/40 bg-[#E55C5C]/10 p-2 text-[12px] text-[#E55C5C]">
          {t("preview.rejectedReason", { reason: rejectionReason })}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {canManage && adSubmittable(status) ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => { await submitAd(adId); router.refresh(); })}
            className={primary}
          >
            {pending ? "…" : t("preview.submit")}
          </button>
        ) : null}
        {canManage && adWithdrawable({ status, hasPending }) ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => { await withdrawAd(adId); router.refresh(); })}
            className={button}
          >
            {pending ? "…" : t("preview.withdraw")}
          </button>
        ) : null}
        <Link href={studioHref} className={button}>{t("preview.backToStudio")}</Link>
      </div>
    </section>
  );
}
