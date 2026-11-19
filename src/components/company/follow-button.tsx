"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { followCompany, unfollowCompany } from "@/app/actions/company-follow";

/**
 * «Следить за магазином» — оно же согласие на рассылку (ТЗ 4.2): без этого нажатия
 * магазин человеку написать не может.
 *
 * Не вошедшему кнопка ведёт на вход с возвратом сюда: подписка без учётной записи
 * означала бы рассылку неизвестно кому.
 */
export function FollowButton({
  companyId,
  locale,
  following,
  signedIn,
}: {
  companyId: string;
  locale: string;
  following: boolean;
  signedIn: boolean;
}) {
  const t = useTranslations("promos");
  const router = useRouter();
  const [on, setOn] = useState(following);
  const [pending, start] = useTransition();

  const cls = "h-12 px-4 rounded-md border border-hairline text-sm hover:border-accent disabled:opacity-50";

  if (!signedIn) {
    const next = encodeURIComponent(`/${locale}/companies/${companyId}`);
    return (
      <a href={`/${locale}/login?next=${next}`} className={cls}>
        {t("follow")}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={cls}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = on ? await unfollowCompany(companyId) : await followCompany(companyId);
          if (r.ok) {
            setOn(!on);
            router.refresh();
          }
        })
      }
    >
      {on ? t("following") : t("follow")}
    </button>
  );
}
