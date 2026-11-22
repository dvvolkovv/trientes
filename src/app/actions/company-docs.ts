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
  isCompanyDocKind,
} from "@/lib/company-docs";
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
  input: { kind: string; title?: string | null; url: string; publish?: boolean },
) {
  const gate = await gateFor(companyId);
  if (!gate.ok) return { ok: false as const, reason: gate.userId ? ("not_found" as const) : ("unauth" as const) };
  if (!isCompanyDocKind(input.kind)) return { ok: false as const, reason: "kind_invalid" as const };

  const url = String(input.url ?? "").trim();
  // Наш файл или чужая ссылка — но только http(s): у половины заведений политика
  // уже лежит на своём сайте, и заставлять их перезагружать pdf незачем.
  const ours = url.startsWith("/uploads/company-docs/");
  if (!ours && !/^https?:\/\//i.test(url)) return { ok: false as const, reason: "url_invalid" as const };

  const count = await prisma.companyDocument.count({ where: { companyId } });
  if (count >= COMPANY_DOCS_MAX) return { ok: false as const, reason: "docs_limit" as const };

  const title = (input.title ?? "").trim().slice(0, COMPANY_DOC_TITLE_MAX) || null;
  // Подпись в журнале — словами, а не ключом реестра: журнал неизменяем, и строка
  // `returnPolicy` через год не расскажет, что произошло (тот же дефект, что cuid
  // заказа в живом прогоне BI). Служебный текст по-английски, как в `notifyUser`.
  const subject = title ?? (await rawMessage("en", `business.docs.kind.${input.kind}`, {}, input.kind));
  const doc = await prisma.companyDocument.create({
    data: {
      companyId,
      kind: input.kind,
      title,
      url,
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

export async function setCompanyDocumentPublished(documentId: string, published: boolean) {
  const doc = await prisma.companyDocument.findUnique({
    where: { id: documentId },
    select: { id: true, companyId: true, kind: true, title: true },
  });
  if (!doc) return { ok: false as const, reason: "not_found" as const };
  const gate = await gateFor(doc.companyId);
  if (!gate.ok) return { ok: false as const, reason: gate.userId ? ("not_found" as const) : ("unauth" as const) };
  const subject = doc.title ?? (await rawMessage("en", `business.docs.kind.${doc.kind}`, {}, doc.kind));

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
    select: { id: true, companyId: true, kind: true, title: true, url: true, publishedAt: true },
  });
  if (!doc) return { ok: false as const, reason: "not_found" as const };
  const gate = await gateFor(doc.companyId);
  if (!gate.ok) return { ok: false as const, reason: gate.userId ? ("not_found" as const) : ("unauth" as const) };
  if (doc.publishedAt) return { ok: false as const, reason: "unpublish_first" as const };
  const subject = doc.title ?? (await rawMessage("en", `business.docs.kind.${doc.kind}`, {}, doc.kind));

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
