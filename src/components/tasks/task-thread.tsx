"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { commentTask } from "@/app/actions/company-tasks";

/** Обсуждение внутри задачи. Общий чат команды — отдельная линия (спека, § 2.8). */
export function TaskThread({
  companyId,
  taskId,
  children,
}: {
  companyId: string;
  taskId: string;
  /** Реплики рисует сервер и передаёт детьми: клиентская копия разошлась бы с ней. */
  children: React.ReactNode;
}) {
  const t = useTranslations("cabinetTasks");
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    setError(null);
    start(async () => {
      const res = await commentTask(companyId, taskId, body);
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setBody("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {children}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm min-h-[70px]"
        maxLength={2000}
        placeholder={t("commentPlaceholder")}
      />
      {error ? (
        <p className="text-sm text-red-400">{t.has(`errors.${error}`) ? t(`errors.${error}`) : error}</p>
      ) : null}
      <button
        type="button"
        onClick={send}
        disabled={pending}
        className="h-12 w-full rounded-md border border-hairline text-sm disabled:opacity-50"
      >
        {pending ? t("saving") : t("comment")}
      </button>
    </div>
  );
}
