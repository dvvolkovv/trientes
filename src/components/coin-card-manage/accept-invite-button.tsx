"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { acceptCardInvite } from "@/app/actions/coin-card-invites";

export function AcceptCardInviteButton({
  token,
  locale,
}: {
  token: string;
  locale: string;
}) {
  const t = useTranslations("inviteCoin");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await acceptCardInvite({ token });
            if (r.ok) router.push(`/${locale}/cabinet/coins/${r.cardId}`);
            else setError(r.reason);
          });
        }}
        className="px-5 py-2.5 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
      >
        {pending ? t("joining") : t("join")}
      </button>
      {error ? <p className="text-red-500 text-xs mt-3">{t(`errors.${error}`)}</p> : null}
    </div>
  );
}
