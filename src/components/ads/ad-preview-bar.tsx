"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { setAdStatus } from "@/app/actions/company-ads";

/**
 * Полоса предпросмотра (слайс CB). Материал снаружи ещё не виден, а эту страницу
 * открыл тот, кто его ведёт: показываем всё ровно так, как увидит покупатель, —
 * но плашкой говорим, что это черновик.
 *
 * Публикация стоит **здесь**, а не только в студии: человек пришёл посмотреть и
 * послушать перед тем, как выкладывать, и заставлять его возвращаться списком за
 * той же кнопкой — лишний шаг там, где решение уже принято.
 */
export function AdPreviewBar({
  status,
  canPublish,
  adId,
  studioHref,
}: {
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  canPublish: boolean;
  adId: string;
  studioHref: string;
}) {
  const t = useTranslations("adPage");
  const router = useRouter();
  const [pending, start] = useTransition();

  const button =
    "flex h-12 items-center justify-center rounded-[14px] border border-hairline bg-card-alt px-4 text-[13px] font-semibold disabled:opacity-50";

  return (
    <section className="rounded-[18px] border border-dashed border-accent/60 bg-accent/8 p-3">
      <p className="text-[13px] font-semibold text-accent">
        {status === "ARCHIVED" ? t("preview.archived") : t("preview.draft")}
      </p>
      <p className="mt-1 text-[12px] text-muted">{t("preview.hint")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {canPublish ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => { await setAdStatus(adId, "PUBLISHED"); router.refresh(); })}
            className="flex h-12 items-center justify-center rounded-[14px] bg-accent px-4 text-[13px] font-bold text-accent-foreground disabled:opacity-50"
          >
            {pending ? "…" : t("preview.publish")}
          </button>
        ) : null}
        <Link href={studioHref} className={button}>{t("preview.backToStudio")}</Link>
      </div>
    </section>
  );
}
