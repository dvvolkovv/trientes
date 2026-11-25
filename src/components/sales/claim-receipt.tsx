"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { claimReceipt } from "@/app/actions/sales";

/**
 * «Сохранить чек в кабинет». Привязывает чек тот, кто держит ссылку, — продавец чужого
 * логина не набирает: иначе кабинет можно засыпать чеками.
 */
export function ClaimReceipt({
  token,
  locale,
  signedIn,
}: {
  token: string;
  locale: string;
  signedIn: boolean;
}) {
  const t = useTranslations("receipt");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  if (!signedIn) {
    return (
      <div className="mt-3 rounded-[12px] border border-hairline bg-card p-3">
        <p className="text-[12.5px] leading-snug text-muted">{t("signInToSave")}</p>
        <Link
          href={`/${locale}/login?next=${encodeURIComponent(`/${locale}/receipt/${token}`)}`}
          className="mt-2 flex min-h-12 items-center justify-center rounded-[12px] border border-hairline px-4 text-[13px] font-medium hover:border-accent"
        >
          {t("signIn")}
        </Link>
      </div>
    );
  }

  if (saved) {
    return (
      <Link
        href={`/${locale}/cabinet/receipts`}
        className="mt-3 flex min-h-12 items-center justify-center rounded-[12px] border border-hairline px-4 text-[13px] font-medium hover:border-accent"
      >
        {t("openMyReceipts")}
      </Link>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await claimReceipt(token);
            if (!res.ok) setError(res.reason);
            else {
              setSaved(true);
              router.refresh();
            }
          })
        }
        className="min-h-12 w-full rounded-[12px] bg-accent px-4 text-[14px] font-semibold text-background disabled:opacity-50"
      >
        {pending ? t("saving") : t("save")}
      </button>
      {error ? <p className="mt-2 text-[12.5px] leading-snug text-danger">{t(`error.${error}`)}</p> : null}
    </div>
  );
}
