/**
 * Вложения переписки лежат в приватном корне и отдаются маршрутом с проверкой
 * прав: здесь ходят те же документы, что в KYB, а публичный /uploads/ отдаётся
 * nginx вообще без проверки — пересланная ссылка была бы открыта навсегда.
 */

export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
export const ATTACHMENT_MAX_PER_MESSAGE = 5;

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** svg сознательно не в списке: это исполняемая разметка, а не картинка. */
export function extForMime(mime: string): string | null {
  return MIME_EXT[mime] ?? null;
}

const NAME_RE = /^[0-9a-f]{24}\.(pdf|png|jpg|webp)$/;

/**
 * Имя файла придумываем мы сами (24 hex + расширение), поэтому проверка строгая
 * и единственная: маршрут отдачи склеивает путь из этого имени.
 */
export function isSafeAttachmentName(name: string): boolean {
  return NAME_RE.test(name);
}

export function attachmentUrl(caseId: string, name: string): string {
  return `/api/case-attachment/${caseId}/${name}`;
}

export type Attachment = { name: string; filename: string; size: number; mime: string };

/** Имя, которое дал человек, показываем — значит, чистим от разметки. */
function cleanFilename(raw: string): string {
  return raw.replace(/[<>"'`\\/]/g, "").trim().slice(0, 120) || "file";
}

/** Колонка `attachments` — JSONB: читаем её терпимо, мусор отбрасываем. */
export function parseAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  const out: Attachment[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : "";
    const mime = typeof r.mime === "string" ? r.mime : "";
    if (!isSafeAttachmentName(name) || !extForMime(mime)) continue;
    out.push({
      name,
      filename: cleanFilename(typeof r.filename === "string" ? r.filename : name),
      size: typeof r.size === "number" && Number.isFinite(r.size) ? Math.max(0, Math.round(r.size)) : 0,
      mime,
    });
    if (out.length === ATTACHMENT_MAX_PER_MESSAGE) break;
  }
  return out;
}
