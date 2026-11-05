"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { acceptInvite } from "@/app/actions/company-invites";

export function AcceptInviteButton({ token, locale }: { token: string; locale: string }) {
  const t = useTranslations("invite");
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
            const r = await acceptInvite({ token });
            if (r.ok) {
              router.push(`/${locale}/cabinet/companies/${r.companyId}`);
              router.refresh();
            } else {
              setError(r.reason);
            }
          });
        }}
        className="px-5 py-2.5 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
      >
        {pending ? t("accepting") : t("accept")}
      </button>
      {error ? <p className="text-red-500 text-xs mt-3">{t(`state.${error}`)}</p> : null}
    </div>
  );
}
