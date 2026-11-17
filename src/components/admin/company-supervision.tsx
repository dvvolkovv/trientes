"use client";

import { useState, useTransition } from "react";
import {
  messageCompany,
  passReview,
  restoreCompanyListing,
  suspendCompany,
  warnCompany,
} from "@/app/actions/company-supervision";
import { ADMIN_BUTTON, ADMIN_BUTTON_DANGER, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";

export type SupervisionLabels = {
  messagePlaceholder: string;
  message: string;
  warn: string;
  suspendPlaceholder: string;
  suspend: string;
  restore: string;
  passReview: string;
  done: string;
  errors: Record<string, string>;
};

type Action = "message" | "warn" | "suspend" | "restore" | "review";

/**
 * Действия надзора. Текст (письмо владельцу или причина снятия) — одно поле на
 * раздел: разные поля под «написать» и «предупредить» значили бы, что человек
 * набрал в одно, а нажал другое.
 */
export function CompanySupervision({
  companyId,
  suspended,
  labels,
  show,
}: {
  companyId: string;
  suspended: boolean;
  labels: SupervisionLabels;
  /** Какие кнопки нужны этому разделу: связь, листинг или пересмотр. */
  show: "contact" | "listing" | "review";
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function run(which: Action) {
    setError(null);
    setDone(false);
    start(async () => {
      const body = text.trim();
      const res =
        which === "message"
          ? await messageCompany({ companyId, body })
          : which === "warn"
            ? await warnCompany({ companyId, body })
            : which === "suspend"
              ? await suspendCompany({ companyId, reason: body })
              : which === "restore"
                ? await restoreCompanyListing({ companyId })
                : await passReview({ companyId });
      if (!res.ok) {
        setError(labels.errors[res.reason] ?? labels.errors.failed);
        return;
      }
      setText("");
      setDone(true);
    });
  }

  const needsText = show !== "review" && !(show === "listing" && suspended);

  return (
    <div className="flex flex-col gap-2.5">
      {needsText ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder={show === "listing" ? labels.suspendPlaceholder : labels.messagePlaceholder}
          className="w-full rounded-[14px] border border-hairline bg-bg-tint p-3 text-[13px] outline-none focus:border-accent"
        />
      ) : null}

      {show === "contact" ? (
        <>
          <button
            type="button"
            disabled={pending || text.trim().length < 3}
            className={ADMIN_BUTTON}
            onClick={() => run("message")}
          >
            {labels.message}
          </button>
          <button
            type="button"
            disabled={pending || text.trim().length < 3}
            className={ADMIN_BUTTON_SECONDARY}
            onClick={() => run("warn")}
          >
            {labels.warn}
          </button>
        </>
      ) : null}

      {show === "listing" ? (
        suspended ? (
          <button
            type="button"
            disabled={pending}
            className={ADMIN_BUTTON}
            onClick={() => run("restore")}
          >
            {labels.restore}
          </button>
        ) : (
          <button
            type="button"
            disabled={pending || text.trim().length < 3}
            className={ADMIN_BUTTON_DANGER}
            onClick={() => run("suspend")}
          >
            {labels.suspend}
          </button>
        )
      ) : null}

      {show === "review" ? (
        <button
          type="button"
          disabled={pending}
          className={ADMIN_BUTTON_SECONDARY}
          onClick={() => run("review")}
        >
          {labels.passReview}
        </button>
      ) : null}

      {error ? <p className="text-[12px] leading-snug text-down">{error}</p> : null}
      {done ? <p className="text-[12px] text-up">{labels.done}</p> : null}
    </div>
  );
}
