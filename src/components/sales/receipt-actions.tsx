"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cancelSale, reissueReceiptLink } from "@/app/actions/sales";
import { QrButton } from "@/components/qr-button";
import { ShareButton } from "@/components/share-button";

/**
 * Действия продавца над чеком. Чек неизменяем, поэтому их два: показать копию
 * покупателю и отменить ошибку встречным движением.
 *
 * Подтверждение отмены — причина словами, а не второе нажатие: причина уходит в журнал
 * и в сам чек, и покупатель её видит.
 */
export function ReceiptActions({
  companyId,
  saleId,
  locale,
  number,
  cancellable,
  claimed,
}: {
  companyId: string;
  saleId: string;
  locale: string;
  number: number;
  cancellable: boolean;
  /** Чек уже в кабинете покупателя — новая ссылка ему не нужна. */
  claimed: boolean;
}) {
  const t = useTranslations("cabinetSales");
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const button =
    "min-h-12 flex-1 rounded-[12px] border border-hairline px-4 text-[13px] font-medium hover:border-accent";

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {claimed ? (
          <p className="w-full text-[12.5px] leading-snug text-muted">{t("alreadyClaimed")}</p>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await reissueReceiptLink(companyId, saleId, locale);
                if (!res.ok) setError(res.reason);
                else setUrl(res.url);
              })
            }
            className={button}
          >
            {t("showAgain")}
          </button>
        )}
        {cancellable ? (
          <button type="button" onClick={() => setAsking((v) => !v)} className={button}>
            {t("cancel")}
          </button>
        ) : null}
      </div>

      {url ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <QrButton text={url} className={button} />
          <ShareButton
            payload={{ title: t("shareTitle"), text: t("shareText", { number }), url }}
            className={button}
          />
          <p className="w-full break-all text-[11px] leading-snug text-muted">{url}</p>
          <p className="w-full text-[11.5px] leading-snug text-muted">{t("reissueHint")}</p>
        </div>
      ) : null}

      {asking ? (
        <div className="mt-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("cancelReason")}
            className="w-full rounded-[10px] border border-hairline bg-card px-3 py-2 text-[16px] md:text-[14px]"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await cancelSale(companyId, saleId, reason);
                if (!res.ok) setError(res.reason);
                else {
                  setAsking(false);
                  router.refresh();
                }
              })
            }
            className="mt-2 min-h-12 w-full rounded-[12px] border border-danger px-4 text-[13px] font-semibold text-danger"
          >
            {t("cancelConfirm")}
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-[12.5px] leading-snug text-danger">{t(`error.${error}`)}</p> : null}
    </div>
  );
}
