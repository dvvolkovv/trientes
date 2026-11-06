"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  requestOrDeleteCompany,
  requestOrDeletePoint,
  voteOnDeletion,
  withdrawDeletion,
} from "@/app/actions/company-deletion";

/**
 * Подпись зависит от прав: владелец удаляет, сотрудник только просит. Решение
 * принимает сервер — здесь только честный текст кнопки, чтобы человек заранее
 * понимал, что произойдёт.
 */
export function DeletePointButton({ pointId, canDeleteOutright }: { pointId: string; canDeleteOutright: boolean }) {
  const t = useTranslations("business.delete");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm(canDeleteOutright ? t("confirmPoint") : t("confirmRequestPoint"))) return;
          setMsg(null);
          start(async () => {
            const r = await requestOrDeletePoint({ pointId });
            if (r.ok) router.refresh();
            else setMsg(t(`err.${r.reason}`));
          });
        }}
        className="text-[11px] px-2 py-1 rounded-md border border-hairline text-muted hover:border-down hover:text-down disabled:opacity-50"
      >
        {canDeleteOutright ? t("point") : t("requestPoint")}
      </button>
      {msg && <p className="text-[11px] text-down mt-1">{msg}</p>}
    </div>
  );
}

/**
 * Удаление компании требует ввести её отображаемое название: это не украшение,
 * а защита от случайного клика по необратимому для пользователя действию.
 */
export function DeleteCompanyBlock({
  companyId,
  displayName,
  canDeleteOutright,
}: {
  companyId: string;
  displayName: string;
  canDeleteOutright: boolean;
}) {
  const t = useTranslations("business.delete");
  const [typed, setTyped] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const armed = typed.trim() === displayName.trim();

  return (
    <section className="border border-down/30 bg-down/5 rounded-md p-4 space-y-3">
      <h2 className="text-[16px] font-semibold text-down">
        {canDeleteOutright ? t("companyTitle") : t("requestCompanyTitle")}
      </h2>
      <p className="text-[13px] text-muted max-w-[620px]">
        {canDeleteOutright ? t("companyHint") : t("requestCompanyHint")}
      </p>
      <p className="text-[12px] text-muted">{t("typeName", { name: displayName })}</p>
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={displayName}
        className="w-full max-w-[380px] bg-bg-tint border border-hairline rounded-md px-3 py-2 text-[13px]"
      />
      <div>
        <button
          type="button"
          disabled={pending || !armed}
          onClick={() => {
            setMsg(null);
            start(async () => {
              const r = await requestOrDeleteCompany({ companyId });
              if (r.ok) router.refresh();
              else setMsg(t(`err.${r.reason}`));
            });
          }}
          className="text-[13px] px-4 py-2 rounded-md font-medium bg-down text-white disabled:opacity-40"
        >
          {canDeleteOutright ? t("company") : t("requestCompany")}
        </button>
      </div>
      {msg && <p className="text-[13px] text-down">{msg}</p>}
    </section>
  );
}

export function DeletionVoteButtons({
  requestId,
  canVote,
  isRequester,
}: {
  requestId: string;
  canVote: boolean;
  isRequester: boolean;
}) {
  const t = useTranslations("business.delete");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function run(fn: () => Promise<{ ok: boolean; reason?: string }>) {
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (r.ok) router.refresh();
      else setMsg(t(`err.${r.reason}`));
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canVote && (
        <>
          <button type="button" disabled={pending}
            onClick={() => run(() => voteOnDeletion({ requestId, vote: "APPROVE" }))}
            className="text-[12px] px-3 py-1.5 rounded-md bg-down text-white disabled:opacity-50">
            {t("approve")}
          </button>
          <button type="button" disabled={pending}
            onClick={() => run(() => voteOnDeletion({ requestId, vote: "REJECT" }))}
            className="text-[12px] px-3 py-1.5 rounded-md border border-hairline text-muted disabled:opacity-50">
            {t("reject")}
          </button>
        </>
      )}
      {isRequester && (
        <button type="button" disabled={pending}
          onClick={() => run(() => withdrawDeletion({ requestId }))}
          className="text-[12px] px-3 py-1.5 rounded-md border border-hairline text-muted disabled:opacity-50">
          {t("withdraw")}
        </button>
      )}
      {msg && <p className="text-[12px] text-down">{msg}</p>}
    </div>
  );
}
