"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { StepTranslator } from "@/components/coin-detail/route-steps-panel";
import { PRIMARY, ROW_BTN, SECONDARY } from "@/components/coin-detail/poi-sheet-ui";

const REASONS = ["CLOSED", "NO_CRYPTO", "WRONG_ADDRESS", "OTHER"] as const;

/**
 * Лист жалобы поверх карточки. Фото не принимаем: загрузка файла от человека,
 * которого мы не знаем, — отдельная дыра, а приватный корень вложений рассчитан
 * на автора, который у нас есть.
 *
 * Портал в `document.body` — по той же причине, что у баннера: дорожка страниц
 * сдвигается `transform`, а трансформированный предок делает `position: fixed`
 * отсчётом от себя, и «во весь экран» вышло бы шириной в страницу.
 */
export function PoiReportDialog({
  pointId,
  onClose,
  t,
}: {
  pointId: string;
  onClose: () => void;
  t: StepTranslator;
}) {
  const [reason, setReason] = useState<(typeof REASONS)[number]>("CLOSED");
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("failed");

  async function send() {
    setState("sending");
    try {
      const res = await fetch("/api/point-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pointId, reason, comment }),
      });
      if (res.ok) {
        setState("sent");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "failed");
      setState("error");
    } catch {
      setError("failed");
      setState("error");
    }
  }

  const sheet = (
    <div
      className="fixed inset-0 z-[70] flex items-end bg-black/60"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-[20px] bg-card p-4 pb-[calc(16px+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-[15px] font-bold">{t("report.title")}</h3>

        {state === "sent" ? (
          <>
            <p className="mb-4 text-[13px] leading-relaxed text-muted">{t("report.sent")}</p>
            <button type="button" onClick={onClose} className={SECONDARY}>
              {t("report.close")}
            </button>
          </>
        ) : (
          <>
            <div className="mb-3 flex flex-col gap-1.5">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  aria-pressed={reason === r}
                  className={`${ROW_BTN} ${reason === r ? "border-accent" : ""}`}
                >
                  <span aria-hidden>{reason === r ? "●" : "○"}</span>
                  {t(`report.reason.${r}`)}
                </button>
              ))}
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder={t("report.commentPlaceholder")}
              className="mb-3 w-full rounded-xl border border-hairline bg-bg-tint/40 p-2.5 text-[13px]"
            />
            {state === "error" && (
              <p className="mb-2 text-[12px] text-down">{t(`report.errors.${error}`)}</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={onClose} className={SECONDARY}>
                {t("report.cancel")}
              </button>
              <button
                type="button"
                onClick={send}
                disabled={state === "sending"}
                className={PRIMARY}
              >
                {state === "sending" ? t("report.sending") : t("report.submit")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return typeof document === "undefined" ? sheet : createPortal(sheet, document.body);
}
