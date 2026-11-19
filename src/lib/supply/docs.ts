/**
 * Накладные и акты по заказу — приватные файлы. Публичный `/uploads/` отдаётся nginx
 * вообще без проверки, а здесь ходят коммерческие документы двух предприятий: та же
 * причина, по которой вложения переписки комплайнса (AO) лежат вне публичных корней.
 *
 * Схема имени и белый список взяты у вложений AO **импортом**, а не копией: имя
 * придумываем мы (24 hex + расширение), svg в список не входит — это исполняемая
 * разметка. Копия правила разошлась бы с первой.
 */
import { extForMime, isSafeAttachmentName, ATTACHMENT_MAX_BYTES } from "@/lib/cases/attachments";
import { MAX_ORDER_DOCS } from "@/lib/supply/rules";

export { extForMime, isSafeAttachmentName };
export const DOC_MAX_BYTES = ATTACHMENT_MAX_BYTES;

export type DocSide = "buyer" | "supplier";

export type SupplyDoc = {
  name: string;
  filename: string;
  size: number;
  mime: string;
  /** Кто принёс бумагу — видно глазом: накладная поставщика и акт покупателя не одно и то же. */
  side: DocSide;
  at: string;
};

export function supplyDocUrl(orderId: string, name: string): string {
  return `/api/supply-doc/${orderId}/${name}`;
}

function cleanFilename(raw: string): string {
  return raw.replace(/[<>"'`\\/]/g, "").trim().slice(0, 120) || "file";
}

/** Колонка `docs` — JSONB: читаем терпимо, мусор отбрасываем (правило чтения AO). */
export function parseDocs(value: unknown): SupplyDoc[] {
  if (!Array.isArray(value)) return [];
  const out: SupplyDoc[] = [];
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
      side: r.side === "supplier" ? "supplier" : "buyer",
      at: typeof r.at === "string" ? r.at : "",
    });
    if (out.length === MAX_ORDER_DOCS) break;
  }
  return out;
}
