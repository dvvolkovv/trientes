"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { markChatRead, pollChat, postChatMessage, withdrawChatMessage } from "@/app/actions/company-chat";
import { CHAT_BODY_CHARS } from "@/lib/company-chat/rules";
import type { ChatRow } from "@/lib/company-chat/read";

export type ChatRoomRow = {
  id: string;
  body: string;
  createdAt: string;
  authorLabel: string | null;
  withdrawn: boolean;
  mine: boolean;
  mentionsMe: boolean;
};

/** Раз в 15 секунд — и только пока вкладка видна (приём биения дела в AN). */
const POLL_MS = 15_000;

function toRoomRow(row: ChatRow): ChatRoomRow {
  return {
    id: row.id,
    body: row.body,
    createdAt: new Date(row.createdAt).toISOString(),
    authorLabel: row.author?.label ?? null,
    withdrawn: row.withdrawn,
    mine: row.mine,
    mentionsMe: row.mentionsMe,
  };
}

/**
 * Комната общего чата команды (слайс BP). Живость — опрос, пока вкладка видна:
 * вебсокетов в проекте нет ни одного, и заводить их ради комнаты из трёх человек
 * несоразмерно (спека § 2.6).
 */
export function ChatRoom({
  companyId,
  isOwner,
  canPost,
  initial,
  members,
  paged,
}: {
  companyId: string;
  isOwner: boolean;
  canPost: boolean;
  initial: ChatRoomRow[];
  members: { username: string; label: string }[];
  /** Открыта страница истории «раньше»: хвоста разговора тут нет, опрос молчит. */
  paged: boolean;
}) {
  const t = useTranslations("cabinetChat");
  const format = useFormatter();
  const [rows, setRows] = useState<ChatRoomRow[]>(initial);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement | null>(null);

  // Опрос спрашивает «что после последнего известного», и ему нужен свежий хвост без
  // перезапуска таймера на каждое сообщение.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const append = useCallback((fresh: ChatRow[]) => {
    if (fresh.length === 0) return;
    setRows((prev) => {
      const known = new Set(prev.map((r) => r.id));
      const add = fresh.filter((r) => !known.has(r.id)).map(toRoomRow);
      return add.length > 0 ? [...prev, ...add] : prev;
    });
  }, []);

  const pull = useCallback(async () => {
    const res = await pollChat(companyId, rowsRef.current[rowsRef.current.length - 1]?.id ?? null);
    if (res.ok) append(res.rows);
  }, [append, companyId]);

  // Открыл комнату — прочёл: значок гаснет при открытии, а не по нажатию. Страница
  // истории прочтением не считается: человек листает прошлое, а не читает новое.
  useEffect(() => {
    if (paged) return;
    void markChatRead(companyId);
  }, [companyId, paged]);

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
      const res = await postChatMessage(companyId, body);
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
      const res = await withdrawChatMessage(companyId, id);
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, withdrawn: true, body: "" } : r)));
    });
  }

  function mention(username: string) {
    const next = body.length === 0 || body.endsWith(" ") ? `${body}@${username} ` : `${body} @${username} `;
    setBody(next.slice(0, CHAT_BODY_CHARS));
    box.current?.focus();
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {rows.length === 0 ? <li className="text-sm text-muted">{t("empty")}</li> : null}
        {rows.map((row) => (
          <li
            key={row.id}
            className={`rounded-[14px] border p-3 ${
              row.mentionsMe ? "border-accent/60 bg-accent/5" : "border-hairline bg-card"
            }`}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-semibold">{row.mine ? t("you") : (row.authorLabel ?? t("gone"))}</span>
              <span className="text-[11px] text-muted">
                {format.dateTime(new Date(row.createdAt), { dateStyle: "short", timeStyle: "short" })}
              </span>
              {row.mentionsMe ? (
                <span className="rounded-full bg-accent/15 px-2 py-[2px] text-[11px] text-accent">
                  {t("mentionedYou")}
                </span>
              ) : null}
            </div>
            {row.withdrawn ? (
              <p className="mt-1 text-sm italic text-muted">{t("withdrawn")}</p>
            ) : (
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{row.body}</p>
            )}
            {!row.withdrawn && (row.mine || isOwner) ? (
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
            ref={box}
            value={body}
            onChange={(event) => setBody(event.target.value.slice(0, CHAT_BODY_CHARS))}
            rows={3}
            placeholder={t("placeholder")}
            className="w-full rounded-md border border-hairline bg-card-alt px-3 py-2 text-sm"
          />
          {members.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <button
                  key={m.username}
                  type="button"
                  onClick={() => mention(m.username)}
                  className="rounded-full border border-hairline px-3 py-1 text-[12px] text-muted"
                >
                  @{m.username}
                </button>
              ))}
            </div>
          ) : null}
          <p className="text-[11px] text-muted">{t("mentionHint")}</p>
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
