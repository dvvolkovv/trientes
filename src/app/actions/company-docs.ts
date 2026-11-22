"use server";

import { revalidatePath } from "next/cache";
import { unlink } from "node:fs/promises";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { editorCompany } from "@/lib/products/editor-company";
import { logCompanyAction } from "@/lib/company-team/journal";
import {
  COMPANY_DOCS_MAX,
  COMPANY_DOC_TITLE_MAX,
  companyDocFilePath,
  isDocLink,
  normalizeDocRubric,
} from "@/lib/company-docs";
import { hasLink } from "@/lib/promos/rules";
import {
  PUBLIC_FIELD_KEYS,
  toPublicFieldsJson,
  type PublicFieldKey,
} from "@/lib/company-public-fields";
import { NOT_DELETED, LIVE_POINT } from "@/lib/soft-delete";
import { rawMessage } from "@/lib/messages-raw";
import type { Prisma } from "@prisma/client";

/**
 * Публичные документы предприятия и настройка публичности карточки (слайс BU).
 *
 * Право одно на оба дела — раздел `card` (BE): документы и выключатели это та же
 * карточка, а право, за которым нет отдельного смысла, было бы обещанием, а не
 * доступом.
 */

async function gateFor(companyId: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!userId) return { userId: null as string | null, ok: false as const };
  const gate = await editorCompany(companyId, userId);
  if (!gate || gate.permissions.card !== "EDIT") return { userId, ok: false as const };
  return { userId, ok: true as const };
}

export async function addCompanyDocument(
  companyId: string,
  input: {
    kind: string;
    /** Своя рубрика словами при `kind = "other"` (слайс BV). */
    kindCustom?: string | null;
    title?: string | null;
    url?: string | null;
    /** Где бумагу можно проверить: страница реестра лицензиара (слайс BV). */
    linkUrl?: string | null;
    publish?: boolean;
  },
) {
  const gate = await gateFor(companyId);
  if (!gate.ok) return { ok: false as const, reason: gate.userId ? ("not_found" as const) : ("unauth" as const) };

  const rubric = normalizeDocRubric(input.kind, input.kindCustom, hasLink);
  if (!rubric.ok) return { ok: false as const, reason: rubric.reason };

  const parsed = parseDocLocation(input.url, input.linkUrl);
  if (!parsed.ok) return { ok: false as const, reason: parsed.reason };

  const count = await prisma.companyDocument.count({ where: { companyId } });
  if (count >= COMPANY_DOCS_MAX) return { ok: false as const, reason: "docs_limit" as const };

  const title = (input.title ?? "").trim().slice(0, COMPANY_DOC_TITLE_MAX) || null;
  const subject = await docSubject(title, rubric.kind, rubric.kindCustom);
  const doc = await prisma.companyDocument.create({
    data: {
      companyId,
      kind: rubric.kind,
      kindCustom: rubric.kindCustom,
      title,
      url: parsed.url,
      linkUrl: parsed.linkUrl,
      uploadedById: gate.userId,
      sortOrder: count,
      // Публикуем сразу, если так попросили: иначе каждый документ требовал бы
      // двух действий, а черновик нужен тому, кто ещё не решил.
      publishedAt: input.publish === false ? null : new Date(),
    },
  });
  await logCompanyAction({
    companyId,
    actorUserId: gate.userId,
    action: "DOCUMENT_ADDED",
    subject,
  });
  revalidatePath("/", "layout");
  return { ok: true as const, id: doc.id };
}

/**
 * Правка документа (слайс BV): название, рубрика и ссылка. Сам файл правкой **не
 * заменяется** — это другой документ: заведи новый и сними прежний, иначе ссылка,
 * которую покупатель уже сохранил, однажды покажет не ту бумагу.
 */
export async function updateCompanyDocument(
  documentId: string,
  input: { kind: string; kindCustom?: string | null; title?: string | null; linkUrl?: string | null },
) {
  const doc = await prisma.companyDocument.findUnique({
    where: { id: documentId },
    select: { id: true, companyId: true, url: true },
  });
  if (!doc) return { ok: false as const, reason: "not_found" as const };
  const gate = await gateFor(doc.companyId);
  if (!gate.ok) return { ok: false as const, reason: gate.userId ? ("not_found" as const) : ("unauth" as const) };

  const rubric = normalizeDocRubric(input.kind, input.kindCustom, hasLink);
  if (!rubric.ok) return { ok: false as const, reason: rubric.reason };
  // Файл остаётся прежним, поэтому «хотя бы одно из двух» считается вместе с ним:
  // снять ссылку у документа с файлом можно, у документа без файла — нет.
  const parsed = parseDocLocation(doc.url, input.linkUrl);
  if (!parsed.ok) return { ok: false as const, reason: parsed.reason };

  const title = (input.title ?? "").trim().slice(0, COMPANY_DOC_TITLE_MAX) || null;
  const subject = await docSubject(title, rubric.kind, rubric.kindCustom);
  await prisma.companyDocument.update({
    where: { id: doc.id },
    data: { kind: rubric.kind, kindCustom: rubric.kindCustom, title, linkUrl: parsed.linkUrl },
  });
  await logCompanyAction({
    companyId: doc.companyId,
    actorUserId: gate.userId,
    action: "DOCUMENT_UPDATED",
    subject,
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Где лежит документ: наш файл, чужой адрес — и отдельно адрес, по которому бумагу
 * **проверяют**. Хотя бы одно из двух обязано быть: документ без файла и без ссылки
 * — строка ни о чём.
 */
function parseDocLocation(
  rawUrl: string | null | undefined,
  rawLink: string | null | undefined,
):
  | { ok: true; url: string | null; linkUrl: string | null }
  | { ok: false; reason: "url_invalid" | "link_invalid" | "url_required" } {
  const url = String(rawUrl ?? "").trim();
  const link = String(rawLink ?? "").trim();
  // Наш файл или чужая ссылка — но только http(s): у половины заведений политика
  // уже лежит на своём сайте, и заставлять их перезагружать pdf незачем.
  if (url !== "" && !url.startsWith("/uploads/company-docs/") && !isDocLink(url)) {
    return { ok: false, reason: "url_invalid" };
  }
  if (link !== "" && !isDocLink(link)) return { ok: false, reason: "link_invalid" };
  if (url === "" && link === "") return { ok: false, reason: "url_required" };
  return { ok: true, url: url || null, linkUrl: link || null };
}

/**
 * Подпись в журнале — словами, а не ключом реестра: журнал неизменяем, и строка
 * `returnPolicy` через год не расскажет, что произошло (тот же дефект, что cuid
 * заказа в живом прогоне BI). Служебный текст по-английски, как в `notifyUser`.
 */
async function docSubject(
  title: string | null,
  kind: string,
  kindCustom: string | null,
): Promise<string> {
  if (title) return title;
  if (kindCustom) return kindCustom;
  return rawMessage("en", `business.docs.kind.${kind}`, {}, kind);
}

export async function setCompanyDocumentPublished(documentId: string, published: boolean) {
  const doc = await prisma.companyDocument.findUnique({
    where: { id: documentId },
    select: { id: true, companyId: true, kind: true, kindCustom: true, title: true },
  });
  if (!doc) return { ok: false as const, reason: "not_found" as const };
  const gate = await gateFor(doc.companyId);
  if (!gate.ok) return { ok: false as const, reason: gate.userId ? ("not_found" as const) : ("unauth" as const) };
  const subject = await docSubject(doc.title, doc.kind, doc.kindCustom);

  await prisma.companyDocument.update({
    where: { id: doc.id },
    data: { publishedAt: published ? new Date() : null },
  });
  await logCompanyAction({
    companyId: doc.companyId,
    actorUserId: gate.userId,
    action: published ? "DOCUMENT_PUBLISHED" : "DOCUMENT_UNPUBLISHED",
    subject,
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Удаление. Опубликованный документ сначала снимают с витрины: покупатель мог
 * сослаться на обещание, и «удалить» в один шаг означало бы, что обещание
 * исчезает без следа. Снятие — одно действие, удаление — другое.
 */
export async function deleteCompanyDocument(documentId: string) {
  const doc = await prisma.companyDocument.findUnique({
    where: { id: documentId },
    select: { id: true, companyId: true, kind: true, kindCustom: true, title: true, url: true, publishedAt: true },
  });
  if (!doc) return { ok: false as const, reason: "not_found" as const };
  const gate = await gateFor(doc.companyId);
  if (!gate.ok) return { ok: false as const, reason: gate.userId ? ("not_found" as const) : ("unauth" as const) };
  if (doc.publishedAt) return { ok: false as const, reason: "unpublish_first" as const };
  const subject = await docSubject(doc.title, doc.kind, doc.kindCustom);

  await prisma.companyDocument.delete({ where: { id: doc.id } });
  // Файл стираем только под нашим корнем: по чужой ссылке стирать нечего.
  const path = companyDocFilePath(doc.url, doc.companyId);
  if (path) await unlink(path).catch(() => {});
  await logCompanyAction({
    companyId: doc.companyId,
    actorUserId: gate.userId,
    action: "DOCUMENT_DELETED",
    subject,
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function saveCompanyPublicFields(
  companyId: string,
  values: Partial<Record<PublicFieldKey, boolean>>,
) {
  const gate = await gateFor(companyId);
  if (!gate.ok) return { ok: false as const, reason: gate.userId ? ("not_found" as const) : ("unauth" as const) };

  // Умолчание точного адреса зависит от того, есть ли у предприятия точки, —
  // поэтому и при записи считаем то же самое: иначе набор, записанный сегодня,
  // завтра значил бы другое.
  const physical = await prisma.companyPoint.count({
    where: { companyId, type: { not: "ONLINE" }, status: "APPROVED", ...LIVE_POINT },
  });
  const clean: Partial<Record<PublicFieldKey, boolean>> = {};
  for (const key of PUBLIC_FIELD_KEYS) {
    if (typeof values[key] === "boolean") clean[key] = values[key];
  }
  const json = toPublicFieldsJson(clean, { hasPhysicalPoints: physical > 0 });

  const company = await prisma.company.findFirst({
    where: { id: companyId, ...NOT_DELETED },
    select: { id: true, displayName: true },
  });
  if (!company) return { ok: false as const, reason: "not_found" as const };

  await prisma.company.update({
    where: { id: company.id },
    data: { publicFields: json as unknown as Prisma.InputJsonValue },
  });
  await logCompanyAction({
    companyId,
    actorUserId: gate.userId,
    action: "PUBLIC_FIELDS_SET",
    subject: company.displayName,
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
