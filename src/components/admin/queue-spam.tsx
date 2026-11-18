"use client";

import { Children, useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { closeCasesAsSpam } from "@/app/actions/case-spam";
import { ADMIN_BUTTON_DANGER, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";
import { SPAM_BATCH_MAX } from "@/lib/cases/spam";

/**
 * Выбор дел в списке очереди и одно действие «закрыть как спам».
 *
 * Строки рисует сервер и передаёт сюда детьми в том же порядке, что `ids`:
 * иначе карточку дела пришлось бы рисовать второй раз, клиентским кодом, и две
 * реализации одной строки разошлись бы.
 */
export function QueueSpamList({
  queue,
  ids,
  children,
}: {
  queue: string;
  ids: string[];
  children: ReactNode;
}) {
  const t = useTranslations("admin.queues.spam");
  const rows = Children.toArray(children);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();

  function toggle(id: string) {
    setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function submit() {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await closeCasesAsSpam({ queue, caseIds: chosen, reason });
      if (!res.ok) {
        const known = ["empty", "too_many", "reason_too_short", "not_spam_closable", "not_found", "no_access"];
        setError(
          known.includes(res.reason)
            ? t(`error.${res.reason}`, { max: SPAM_BATCH_MAX })
            : t("error.failed", { reason: res.reason }),
        );
        return;
      }
      setDone(res.closed);
      setChosen([]);
      setPicking(false);
      setReason("");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {done !== null ? <p className="text-[13px] text-up">{t("done", { count: done })}</p> : null}

      {!picking ? (
        <button type="button" className={ADMIN_BUTTON_SECONDARY} onClick={() => setPicking(true)}>
          {t("mark")}
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-[18px] border border-hairline bg-card-alt p-3">
          <p className="text-[13px] font-semibold">{t("selected", { count: chosen.length })}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className={ADMIN_BUTTON_SECONDARY}
              onClick={() => setChosen(ids.slice(0, SPAM_BATCH_MAX))}
            >
              {t("selectAll")}
            </button>
            <button type="button" className={ADMIN_BUTTON_SECONDARY} onClick={() => setChosen([])}>
              {t("clear")}
            </button>
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reason")}
            className="h-12 w-full rounded-[14px] border border-hairline bg-card px-4 text-sm"
          />
          <p className="text-[12px] text-muted">{t("limit", { max: SPAM_BATCH_MAX })}</p>
          {error ? <p className="text-[12px] text-down">{error}</p> : null}
          <button
            type="button"
            className={ADMIN_BUTTON_DANGER}
            disabled={pending || chosen.length === 0}
            onClick={submit}
          >
            {t("close", { count: chosen.length })}
          </button>
          <button
            type="button"
            className={ADMIN_BUTTON_SECONDARY}
            onClick={() => {
              setPicking(false);
              setChosen([]);
              setError(null);
            }}
          >
            {t("cancel")}
          </button>
        </div>
      )}

      {rows.map((row, i) => {
        const id = ids[i];
        if (!picking) return <div key={id}>{row}</div>;
        const on = chosen.includes(id);
        return (
          <div key={id} className="flex items-stretch gap-2">
            <button
              type="button"
              aria-pressed={on}
              onClick={() => toggle(id)}
              className={`flex w-12 shrink-0 items-center justify-center rounded-[14px] border text-lg ${
                on ? "border-down bg-down/15 text-down" : "border-hairline bg-card text-muted"
              }`}
            >
              {on ? "✓" : ""}
            </button>
            <div className="min-w-0 flex-1">{row}</div>
          </div>
        );
      })}
    </div>
  );
}
