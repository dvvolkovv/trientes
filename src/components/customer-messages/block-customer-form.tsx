"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { setCustomerBlocked } from "@/app/actions/customer-messages";

/**
 * Блокировка покупателя магазином (§ 2.7). Причина необязательна и видна только своим:
 * блокировка — конец разговора, а не его продолжение.
 */
export function BlockCustomerForm({
  companyId,
  threadId,
  blocked,
  buttonClass,
}: {
  companyId: string;
  threadId: string;
  blocked: boolean;
  buttonClass: string;
}) {
  const t = useTranslations("customerMessages");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function act(next: boolean) {
    setError(null);
    start(async () => {
      const res = await setCustomerBlocked(companyId, threadId, next, next ? reason : null);
      if (!res.ok) setError(res.reason);
    });
  }

  if (blocked) {
    return (
      <div className="space-y-2 rounded-[14px] border border-hairline bg-card p-3">
        <p className="text-sm text-muted">{t("unblockHint")}</p>
        {error ? <p className="text-[12px] text-down">{t(`errors.${error}`)}</p> : null}
        <button type="button" onClick={() => act(false)} disabled={pending} className={buttonClass}>
          {t("unblock")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-[14px] border border-hairline bg-card p-3">
      <p className="text-sm font-semibold">{t("blockTitle")}</p>
      <p className="text-sm text-muted">{t("blockHint")}</p>
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value.slice(0, 200))}
        placeholder={t("blockReasonPlaceholder")}
        className="w-full rounded-md border border-hairline bg-card-alt px-3 py-2 text-sm"
      />
      {error ? <p className="text-[12px] text-down">{t(`errors.${error}`)}</p> : null}
      <button type="button" onClick={() => act(true)} disabled={pending} className={buttonClass}>
        {t("block")}
      </button>
    </div>
  );
}
