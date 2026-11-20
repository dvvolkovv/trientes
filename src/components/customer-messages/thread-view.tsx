"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  markThreadRead,
  pollThread,
  replyAsCustomer,
  replyAsStore,
  withdrawCustomerMessage,
} from "@/app/actions/customer-messages";
import {
  CUSTOMER_BODY_CHARS,
  canWithdrawCustomerMessage,
  type CustomerSideKey,
} from "@/lib/customer-messages/rules";
import type { CustomerMessageRow } from "@/lib/customer-messages/read";

export type ThreadViewRow = {
  id: string;
  body: string;
  side: CustomerSideKey;
  createdAt: string;
  mine: boolean;
  withdrawn: boolean;
  authorLabel: string | null;
  authorUserId: string | null;
};

/** Раз в 15 секунд — и только пока вкладка видна (приём BP). */
const POLL_MS = 15_000;

/**
 * Разговор покупателя с магазином (слайс BQ). Один компонент на обе стороны: правила
 * разные, а вид разговора один, и вторая копия разошлась бы с первой.
 */
export function ThreadView({
  threadId,
  companyId,
  side,
  viewerUserId,
  canPost,
  isOwner,
  blocked,
  initial,
  paged,
}: {
  threadId: string;
  /** Нужен только стороне магазина: ответ идёт через права предприятия. */
  companyId: string | null;
  side: CustomerSideKey;
  /** Кто смотрит: отозвать своё вправе автор, слово магазина — ещё и владелец. */
  viewerUserId: string;
  canPost: boolean;
  isOwner: boolean;
  /** Разговор закрыт блокировкой: покупатель своих слов уже не убирает. */
  blocked: boolean;
  initial: ThreadViewRow[];
  /** Открыта страница истории «раньше»: хвоста разговора тут нет, опрос молчит. */
  paged: boolean;
}) {
  const t = useTranslations("customerMessages");
  const format = useFormatter();
  const [rows, setRows] = useState<ThreadViewRow[]>(initial);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const append = useCallback((fresh: CustomerMessageRow[]) => {
    if (fresh.length === 0) return;
    setRows((prev) => {
      const known = new Set(prev.map((r) => r.id));
      const add = fresh
        .filter((r) => !known.has(r.id))
        .map((r) => ({
          id: r.id,
          body: r.body,
          side: r.side,
          createdAt: new Date(r.createdAt).toISOString(),
          mine: r.mine,
          withdrawn: r.withdrawn,
          authorLabel: r.authorLabel,
          authorUserId: r.authorUserId,
        }));
      return add.length > 0 ? [...prev, ...add] : prev;
    });
  }, []);

  /**
   * Право отозвать считает та же чистая функция, что и сервер
   * (`canWithdrawCustomerMessage`): вторая копия правила в браузере показала бы кнопку,
   * которую действие отвергает, — обманка хуже отказа (правило BI).
   */
  const withdrawable = (row: ThreadViewRow): boolean =>
    canWithdrawCustomerMessage(
      { side: row.side, authorUserId: row.authorUserId, deletedAt: row.withdrawn ? new Date() : null },
      { userId: viewerUserId, side, isOwner, threadBlocked: blocked },
    );

  const pull = useCallback(async () => {
    const last = rowsRef.current[rowsRef.current.length - 1]?.createdAt ?? null;
    const res = await pollThread(threadId, side, last);
    if (res.ok) append(res.rows);
  }, [append, side, threadId]);

  // Открыл разговор — прочёл. Страница истории прочтением не считается: человек
  // листает прошлое, а не читает новое (правило BP).
  useEffect(() => {
    if (paged) return;
    void markThreadRead(threadId, side);
  }, [paged, side, threadId]);

  useEffect(() => {
    if (paged) return;
    let alive = true;
    const tick = () => {
      if (!alive || document.visibilityState !== "visible") return;
      void pull();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [paged, pull]);

  function send() {
    setError(null);
    start(async () => {
      const res =
        side === "STORE" && companyId
          ? await replyAsStore(companyId, threadId, body)
          : await replyAsCustomer(threadId, body);
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setBody("");
      await pull();
    });
  }

  function withdraw(id: string) {
    setError(null);
    start(async () => {
      const res = await withdrawCustomerMessage(threadId, id);
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, withdrawn: true, body: "" } : r)));
    });
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {rows.length === 0 ? <li className="text-sm text-muted">{t("empty")}</li> : null}
        {rows.map((row) => (
          <li
            key={row.id}
            className={`rounded-[14px] border p-3 ${
              row.mine ? "border-accent/40 bg-accent/5" : "border-hairline bg-card"
            }`}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-semibold">
                {row.side === "STORE"
                  ? row.authorLabel
                    ? `${t("store")} · ${row.authorLabel}`
                    : t("store")
                  : t("customer")}
              </span>
              <span className="text-[11px] text-muted">
                {format.dateTime(new Date(row.createdAt), { dateStyle: "short", timeStyle: "short" })}
              </span>
            </div>
            {row.withdrawn ? (
              <p className="mt-1 text-sm italic text-muted">{t("withdrawn")}</p>
            ) : (
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{row.body}</p>
            )}
            {!row.withdrawn && withdrawable(row) ? (
              <button
                type="button"
                onClick={() => withdraw(row.id)}
                disabled={pending}
                className="mt-2 text-[12px] text-muted underline disabled:opacity-40"
              >
                {t("withdraw")}
              </button>
            ) : null}
          </li>
        ))}
      </ol>

      {canPost ? (
        <div className="space-y-2 rounded-[14px] border border-hairline bg-card p-3">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value.slice(0, CUSTOMER_BODY_CHARS))}
            rows={3}
            placeholder={side === "STORE" ? t("replyPlaceholder") : t("placeholder")}
            className="w-full rounded-md border border-hairline bg-card-alt px-3 py-2 text-sm"
          />
          {error ? <p className="text-[12px] text-down">{t(`errors.${error}`)}</p> : null}
          <button
            type="button"
            onClick={send}
            disabled={pending || body.trim().length === 0}
            className="flex h-12 w-full items-center justify-center rounded-[14px] bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-40"
          >
            {pending ? t("sending") : t("send")}
          </button>
        </div>
      ) : (
        <p className="rounded-[14px] border border-hairline bg-card p-3 text-sm text-muted">{t("readOnly")}</p>
      )}
    </div>
  );
}
