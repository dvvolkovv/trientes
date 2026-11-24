"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  SHARE_TARGETS,
  shareTargetHref,
  type SharePayload,
  type ShareTargetKey,
} from "@/lib/share-targets";

/**
 * Кнопка «Поделиться» для ссылки, которую надо передать человеку.
 *
 * На телефоне всё отдаётся системному окну (`navigator.share`): в нём стоит
 * ровно то, что у человека установлено — почта, сообщения, Telegram, WhatsApp,
 * Signal, AirDrop, — и свой список приложений там был бы и короче, и лживее.
 * Своё окно открывается только там, где системного нет (обычный браузер на
 * компьютере), и тогда в нём четыре явных адреса.
 *
 * Поддержка **не проверяется на отрисовке**: сервер о `navigator` не знает, и
 * расхождение разметки давало бы ошибку гидратации (живой прогон BY уже ловил
 * это на `speechSynthesis`). Поэтому путь выбирается в момент нажатия.
 */
export function ShareButton({
  payload,
  className,
  panelClassName,
}: {
  payload: SharePayload;
  className: string;
  /** Чем окно выделяется на своём фоне: у кабинета и админки фоны разные. */
  panelClassName?: string;
}) {
  const t = useTranslations("common.share");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function share() {
    if (open) return setOpen(false);
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: payload.title, text: payload.text, url: payload.url });
        return;
      } catch (err) {
        // Отказ человека («не делиться») — не беда и второго окна не требует;
        // любой другой отказ значит, что системное окно нам недоступно.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    setOpen(true);
  }

  function hrefFor(key: ShareTargetKey) {
    return shareTargetHref(key, payload);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void share()}
        aria-expanded={open}
        className={className}
      >
        {t("share")}
      </button>
      {open ? (
        <div
          className={`w-full basis-full rounded-[14px] border border-hairline p-2 ${panelClassName ?? "bg-card"}`}
        >
          <p className="px-1 pb-1.5 text-[11px] leading-snug text-muted">{t("via")}</p>
          <div className="flex flex-col gap-1.5">
            {SHARE_TARGETS.map((target) => (
              <a
                key={target.key}
                href={hrefFor(target.key)}
                target={target.key === "email" || target.key === "sms" ? undefined : "_blank"}
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center gap-2 rounded-[12px] border border-hairline bg-bg-tint px-3 text-[13px] text-foreground hover:border-accent"
              >
                <span aria-hidden>{target.icon}</span>
                {t(`target.${target.key}`)}
              </a>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-1.5 min-h-11 w-full rounded-[12px] border border-hairline px-3 text-[12px] text-muted hover:border-accent"
          >
            {t("close")}
          </button>
        </div>
      ) : null}
    </>
  );
}
