"use client";

import { useRef, useState, useTransition } from "react";
import { sendApplicantMessage, sendStaffMessage } from "@/app/actions/case-messages";
import { ATTACHMENT_MAX_PER_MESSAGE, type Attachment } from "@/lib/cases/attachments";
import { ADMIN_BUTTON } from "@/lib/admin-ui";

export type ComposerLabels = {
  placeholder: string;
  send: string;
  needsReply: string;
  templates: string;
  attach: string;
  attaching: string;
  /** С плейсхолдером {count} — подставляется на клиенте. */
  attached: string;
  errors: Record<string, string>;
};

/**
 * Одна форма на обе стороны. Заготовки показываются только сотруднику и уже на
 * языке заявителя: текст прочитает он, а не мы.
 */
export function CaseComposer({
  caseId,
  side,
  labels,
  templates,
}: {
  caseId: string;
  side: "STAFF" | "APPLICANT";
  labels: ComposerLabels;
  templates?: { key: string; label: string; text: string }[];
}) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [needsReply, setNeedsReply] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const failed = labels.errors.failed ?? "";

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set("caseId", caseId);
      form.set("file", file);
      const res = await fetch("/api/case-attachment/upload", { method: "POST", body: form });
      const json = (await res.json()) as { ok?: boolean; error?: string } & Attachment;
      if (!res.ok || !json.ok) {
        setError(labels.errors[json.error ?? "failed"] ?? failed);
        return;
      }
      setFiles((prev) =>
        prev.length >= ATTACHMENT_MAX_PER_MESSAGE
          ? prev
          : [...prev, { name: json.name, filename: json.filename, size: json.size, mime: json.mime }],
      );
    } catch {
      setError(failed);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function submit() {
    setError(null);
    start(async () => {
      const payload = { caseId, body, attachments: files };
      const res =
        side === "STAFF"
          ? await sendStaffMessage({ ...payload, needsReply })
          : await sendApplicantMessage(payload);
      if (!res.ok) {
        setError(labels.errors[res.reason] ?? failed);
        return;
      }
      setBody("");
      setFiles([]);
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2.5">
      {templates && templates.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted">{labels.templates}</span>
          <div className="flex flex-wrap gap-1.5">
            {templates.map((tpl) => (
              <button
                key={tpl.key}
                type="button"
                onClick={() => setBody((prev) => (prev ? `${prev}\n\n${tpl.text}` : tpl.text))}
                className="rounded-full border border-hairline bg-card-alt px-3 py-2 text-[11.5px] font-medium hover:border-accent/60"
              >
                {tpl.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={labels.placeholder}
        rows={4}
        className="w-full rounded-[14px] border border-hairline bg-card-alt p-3 text-[13px] outline-none focus:border-accent/60"
      />

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <button
          type="button"
          disabled={uploading || files.length >= ATTACHMENT_MAX_PER_MESSAGE}
          onClick={() => fileInput.current?.click()}
          className="flex h-12 items-center gap-2 rounded-[14px] border border-hairline bg-card px-4 text-[12.5px] font-semibold disabled:opacity-40"
        >
          📎 {uploading ? labels.attaching : labels.attach}
        </button>
        {files.length > 0 ? (
          <span className="text-[11.5px] text-muted">
            {labels.attached.replace("{count}", String(files.length))}
          </span>
        ) : null}
      </div>

      {side === "STAFF" ? (
        <label className="flex items-center gap-2.5 text-[12px]">
          <input
            type="checkbox"
            checked={needsReply}
            onChange={(e) => setNeedsReply(e.target.checked)}
            className="h-4 w-4"
          />
          {labels.needsReply}
        </label>
      ) : null}

      {error ? <p className="text-[12px] text-down">{error}</p> : null}

      <button type="button" disabled={pending || uploading} onClick={submit} className={ADMIN_BUTTON}>
        {labels.send}
      </button>
    </div>
  );
}
