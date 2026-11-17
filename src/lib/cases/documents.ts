import type { CaseSubjectType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { attachmentUrl, parseAttachments } from "./attachments";

/**
 * Документы дела не загружаются в деле заново: вердикт ставится на то, что
 * человек уже прислал. Источников ровно два — анкета KYB (`Company.kybDocuments`)
 * и вложения сообщений заявителя из переписки слайса AO. Третий путь загрузки
 * означал бы третье место, где нужно следить за приватностью файлов.
 */

export type CollectedDocument = { kind: string; url: string; label: string | null };

const KYB_KINDS = new Set(["REGISTRATION_CERT", "TAX_CERT", "ID", "OTHER"]);

/** `kybDocuments` — JSONB, читаем терпимо: мусор отбрасываем, а не падаем. */
export function collectKybDocuments(value: unknown): CollectedDocument[] {
  if (!Array.isArray(value)) return [];
  const out: CollectedDocument[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;
    const kind = typeof r.kind === "string" && KYB_KINDS.has(r.kind) ? r.kind : "OTHER";
    const label = typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 120) : null;
    out.push({ kind: `KYB_${kind}`, url, label });
  }
  return out;
}

export function collectMessageDocuments(
  caseId: string,
  messages: { side: string; attachments: unknown }[],
): CollectedDocument[] {
  const out: CollectedDocument[] = [];
  for (const m of messages) {
    // Наши собственные вложения судить незачем: вердикт нужен присланному.
    if (m.side !== "APPLICANT") continue;
    for (const a of parseAttachments(m.attachments)) {
      out.push({ kind: "MESSAGE_ATTACHMENT", url: attachmentUrl(caseId, a.name), label: a.filename });
    }
  }
  return out;
}

/** Один адрес — одна строка: тот же файл, присланный дважды, судится один раз. */
export function dedupeDocuments(rows: CollectedDocument[]): CollectedDocument[] {
  const seen = new Set<string>();
  const out: CollectedDocument[] = [];
  for (const r of rows) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out;
}

/**
 * Идемпотентно доводит строки документов до того, что видно в источниках.
 * Исчезнувший из источника документ **не удаляется**: его видели и по нему
 * высказались, снос строки стёр бы вердикт.
 */
export async function syncCaseDocuments(input: {
  caseId: string;
  subjectType: CaseSubjectType;
  subjectId: string;
}): Promise<void> {
  const collected: CollectedDocument[] = [];

  if (input.subjectType === "KYB" || input.subjectType === "COMPANY") {
    const company = await prisma.company.findUnique({
      where: { id: input.subjectId },
      select: { kybDocuments: true },
    });
    collected.push(...collectKybDocuments(company?.kybDocuments));
  }

  const messages = await prisma.caseMessage.findMany({
    where: { caseId: input.caseId, side: "APPLICANT" },
    select: { side: true, attachments: true },
  });
  collected.push(...collectMessageDocuments(input.caseId, messages));

  const rows = dedupeDocuments(collected);
  if (rows.length === 0) return;
  await prisma.caseDocument.createMany({
    data: rows.map((r) => ({ caseId: input.caseId, kind: r.kind, url: r.url, label: r.label })),
    skipDuplicates: true,
  });
}
