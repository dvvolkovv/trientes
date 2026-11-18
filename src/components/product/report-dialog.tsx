"use client";

import { useState } from "react";
import { MarkCaptcha, type CaptchaSolution } from "@/components/captcha/mark-captcha";

const REASONS = ["WRONG_DATA", "FAKE", "NOT_MINE", "ILLEGAL", "OTHER"] as const;

type Labels = {
  open: string;
  title: string;
  reason: Record<(typeof REASONS)[number], string>;
  commentLabel: string;
  send: string;
  cancel: string;
  sent: string;
  errors: Record<string, string>;
  failed: string;
};

/**
 * Жалоба на паспорт товара. Фото от анонима не принимаем — то же решение, что у жалоб
 * на точки: загрузка файла от человека, которого мы не знаем, это отдельная дыра.
 */
export function ProductReportDialog({ productId, labels }: { productId: string; labels: Labels }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]>("WRONG_DATA");
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("failed");
  const [captcha, setCaptcha] = useState<CaptchaSolution | null>(null);
  // Отказ по капче гасит задачу: ключ меняется — компонент берёт новую, иначе человек
  // упирался бы в «проверка не пройдена» навсегда.
  const [captchaAttempt, setCaptchaAttempt] = useState(0);

  async function send() {
    setState("sending");
    try {
      const res = await fetch("/api/product-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId, reason, comment, captcha }),
      });
      if (res.ok) {
        setState("sent");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      const code = data.error ?? "failed";
      if (code.startsWith("captcha_")) setCaptchaAttempt((n) => n + 1);
      setError(code);
      setState("error");
    } catch {
      setError("failed");
      setState("error");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-12 px-4 rounded-md border border-hairline text-sm hover:border-accent"
      >
        {labels.open}
      </button>
    );
  }

  if (state === "sent") {
    return <p className="text-sm text-accent">{labels.sent}</p>;
  }

  return (
    <div className="border border-hairline rounded-lg p-4 bg-card max-w-[520px]">
      <h3 className="text-sm font-semibold mb-3">{labels.title}</h3>
      <div className="flex flex-col gap-2 mb-3">
        {REASONS.map((r) => (
          <label key={r} className="flex items-center gap-2 text-sm">
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
            {labels.reason[r]}
          </label>
        ))}
      </div>
      <label className="block text-xs text-muted mb-1">{labels.commentLabel}</label>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        maxLength={1000}
        className="w-full bg-background border border-hairline rounded-md px-3 py-2 text-sm mb-3"
      />
      <MarkCaptcha key={captchaAttempt} onSolved={setCaptcha} />
      {state === "error" ? (
        <p className="text-sm text-danger my-2">{labels.errors[error] ?? labels.failed}</p>
      ) : null}
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={send}
          disabled={state === "sending"}
          className="h-12 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
        >
          {labels.send}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-12 px-4 rounded-md border border-hairline text-sm">
          {labels.cancel}
        </button>
      </div>
    </div>
  );
}
