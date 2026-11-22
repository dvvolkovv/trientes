"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { messageStore } from "@/app/actions/customer-messages";
import { CUSTOMER_BODY_CHARS } from "@/lib/customer-messages/rules";
import { CARD_ACTION, CARD_ACTION_PRIMARY } from "@/lib/company-card-ui";

/**
 * «Написать магазину» — первая дверь снаружи внутрь кабинета мерчанта (слайс BQ).
 *
 * Не вошедшему кнопка ведёт на вход с возвратом сюда: анонимная дверь — дверь без
 * обратного адреса, ответ магазина некому доставить (спека § 2.1). Нитка одна на
 * магазин, поэтому у уже начавшего разговор кнопка ведёт прямо в него.
 */
export function MessageStoreButton({
  companyId,
  locale,
  signedIn,
  threadId,
  isMember,
}: {
  companyId: string;
  locale: string;
  signedIn: boolean;
  /** Разговор уже начат — ведём в него, а не предлагаем начать второй. */
  threadId: string | null;
  /** Свой же магазин: сотрудник отвечает изнутри, писать себе снаружи незачем. */
  isMember: boolean;
}) {
  const t = useTranslations("customerMessages");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Переписка — главное действие карточки предприятия, поэтому заливка accent, а
  // остальные кнопки ряда (позвонить, витрина, карта) остаются обведёнными.
  const cls = CARD_ACTION_PRIMARY;

  if (isMember) return null;

  if (!signedIn) {
    const next = encodeURIComponent(`/${locale}/companies/${companyId}`);
    return (
      <a href={`/${locale}/login?next=${next}`} className={cls}>
        {t("write")}
      </a>
    );
  }

  if (threadId) {
    return (
      <a href={`/${locale}/cabinet/messages/${threadId}`} className={cls}>
        {t("openThread")}
      </a>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={cls}>
        {t("write")}
      </button>
    );
  }

  function send() {
    setError(null);
    start(async () => {
      const res = await messageStore(companyId, body);
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      router.push(`/${locale}/cabinet/messages/${res.threadId}`);
    });
  }

  return (
    <div className="w-full space-y-2 rounded-[14px] border border-hairline bg-card-alt p-3 sm:col-span-2">
      <p className="text-sm font-semibold">{t("write")}</p>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value.slice(0, CUSTOMER_BODY_CHARS))}
        rows={3}
        placeholder={t("placeholder")}
        className="w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm"
      />
      {error ? <p className="text-[12px] text-down">{t(`errors.${error}`)}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={send}
          disabled={pending || body.trim().length === 0}
          className="flex h-12 flex-1 items-center justify-center rounded-[14px] bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-40"
        >
          {pending ? t("sending") : t("send")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={`${CARD_ACTION} flex-1`}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
