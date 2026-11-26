"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canWrite, editorCompany } from "@/lib/products/editor-company";
import { pointScopeAllows } from "@/lib/company-team/permissions";
import { logCompanyAction } from "@/lib/company-team/journal";
import { notifyUser } from "@/lib/notify";
import { rawMessage } from "@/lib/messages-raw";
import { parsePromoInput, promoWindow, type PromoInput } from "@/lib/promos/rules";
import { companySendGate, planDeliveries, type SkipOutcome } from "@/lib/promos/antispam";
import { companySendState, recipientStates } from "@/lib/promos/read";
import { inSegment, isCrmSegment } from "@/lib/crm/segments";
import { readCompanyCustomers } from "@/lib/crm/read";

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

/** Акций на предприятие — столько, сколько человек читает списком. */
const MAX_PROMOS = 100;

type Links = { productId?: string | null; pointId?: string | null };

/**
 * Привязки проверяются на принадлежность предприятию и на участок того, кто нажал:
 * акция, привязанная к точке, которой сотрудник не видит, была бы акцией-невидимкой
 * (то же правило, что назначение задачи вне участка в BF).
 */
async function checkLinks(companyId: string, links: Links, pointScope: string[]): Promise<string | null> {
  if (links.pointId) {
    const point = await prisma.companyPoint.findFirst({
      where: { id: links.pointId, companyId },
      select: { id: true },
    });
    if (!point) return "point_not_found";
    if (!pointScopeAllows(pointScope, links.pointId)) return "point_out_of_scope";
  }
  if (links.productId) {
    // Привязать можно только то, что предприятие само продаёт: акция на чужой товар без
    // своего предложения обещала бы покупателю то, чего у продавца нет.
    const offer = await prisma.productOffer.findFirst({
      where: { companyId, productId: links.productId },
      select: { id: true },
    });
    if (!offer) return "product_not_offered";
  }
  return null;
}

function revalidatePromo(companyId: string, productSlug?: string | null) {
  revalidatePath(`/[locale]/companies/${companyId}`, "page");
  if (productSlug) revalidatePath(`/[locale]/product/${productSlug}`, "page");
}

export async function createPromo(companyId: string, input: PromoInput & Links) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  if (!canWrite(gate, "promos")) return fail("forbidden");

  const parsed = parsePromoInput(input, new Date());
  if (!parsed.ok) return fail(parsed.reason);

  const open = await prisma.merchantPromo.count({ where: { companyId, archivedAt: null } });
  if (open >= MAX_PROMOS) return fail("too_many");

  const linkError = await checkLinks(companyId, input, gate!.pointScope);
  if (linkError) return fail(linkError);

  const promo = await prisma.merchantPromo.create({
    data: {
      companyId,
      title: parsed.value.title,
      body: parsed.value.body,
      startsAt: parsed.value.startsAt,
      endsAt: parsed.value.endsAt,
      productId: input.productId || null,
      pointId: input.pointId || null,
    },
    select: { id: true, product: { select: { slug: true } } },
  });
  await logCompanyAction({ companyId, actorUserId: userId, action: "PROMO_CREATED", subject: parsed.value.title });
  revalidatePromo(companyId, promo.product?.slug);
  return { ok: true as const, id: promo.id };
}

export async function updatePromo(promoId: string, input: PromoInput & Links) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const promo = await prisma.merchantPromo.findUnique({
    where: { id: promoId },
    select: { id: true, companyId: true, sentAt: true, product: { select: { slug: true } } },
  });
  if (!promo) return fail("not_found");
  const gate = await editorCompany(promo.companyId, userId);
  if (!canWrite(gate, "promos")) return fail("forbidden");

  const parsed = parsePromoInput(input, new Date());
  if (!parsed.ok) return fail(parsed.reason);
  const linkError = await checkLinks(promo.companyId, input, gate!.pointScope);
  if (linkError) return fail(linkError);

  // Разосланную акцию правим, но текст её рассылки уже у людей: в кабинете об этом
  // сказано прямо, а запрещать правку опечатки на витрине было бы хуже.
  await prisma.merchantPromo.update({
    where: { id: promoId },
    data: {
      title: parsed.value.title,
      body: parsed.value.body,
      startsAt: parsed.value.startsAt,
      endsAt: parsed.value.endsAt,
      productId: input.productId || null,
      pointId: input.pointId || null,
    },
  });
  await logCompanyAction({
    companyId: promo.companyId,
    actorUserId: userId,
    action: "PROMO_UPDATED",
    subject: parsed.value.title,
  });
  revalidatePromo(promo.companyId, promo.product?.slug);
  return { ok: true as const };
}

/**
 * Архив, а не удаление: разосланная акция — это обещание, которое люди получили, и
 * числа рассылки должны остаться читаемыми (прецедент: отменённое движение склада в BC
 * и отменённая задача в BF остаются строкой).
 */
export async function setPromoArchived(promoId: string, archived: boolean) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const promo = await prisma.merchantPromo.findUnique({
    where: { id: promoId },
    select: { id: true, companyId: true, title: true, product: { select: { slug: true } } },
  });
  if (!promo) return fail("not_found");
  const gate = await editorCompany(promo.companyId, userId);
  if (!canWrite(gate, "promos")) return fail("forbidden");

  await prisma.merchantPromo.update({
    where: { id: promoId },
    data: { archivedAt: archived ? new Date() : null },
  });
  await logCompanyAction({
    companyId: promo.companyId,
    actorUserId: userId,
    action: archived ? "PROMO_ARCHIVED" : "PROMO_RESTORED",
    subject: promo.title,
  });
  revalidatePromo(promo.companyId, promo.product?.slug);
  return { ok: true as const };
}

/**
 * Рассылка подписчикам — один раз по одной акции. Повторная рассылка того же текста и
 * есть спам в чистом виде, и запретить его правилом дешевле, чем ловить лимитами:
 * вторая рассылка означает новую акцию со своим сроком и своим расходом квоты.
 */
export async function sendPromo(promoId: string, segment?: string | null) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const promo = await prisma.merchantPromo.findUnique({
    where: { id: promoId },
    select: {
      id: true,
      companyId: true,
      title: true,
      body: true,
      startsAt: true,
      endsAt: true,
      archivedAt: true,
      sentAt: true,
      company: { select: { displayName: true } },
      product: { select: { slug: true } },
    },
  });
  if (!promo) return fail("not_found");
  const gate = await editorCompany(promo.companyId, userId);
  if (!canWrite(gate, "promos")) return fail("forbidden");
  if (promo.sentAt) return fail("already_sent");
  if (promo.archivedAt) return fail("archived");

  const now = new Date();
  // Рассылать можно только то, что человек, перейдя по ссылке, увидит: закончившаяся
  // акция привела бы его на пустую витрину.
  if (promoWindow(promo, now) !== "running") return fail("not_running");

  // Адресная рассылка тратит **ту же** суточную квоту: иначе шесть сегментов
  // превратились бы в шесть сообщений в день, и антиспам BG перестал бы значить
  // что-либо (спека CN, раздел 5).
  const state = await companySendState(promo.companyId, now);
  const quota = companySendGate(state, now);
  if (!quota.ok) return fail(quota.reason);

  // Сегмент сужает список подписчиков и никогда его не расширяет: покупка согласием
  // на рекламу не является. Неизвестный ключ отвергаем вслух — молча разослать всем
  // значило бы написать тем, кому мерчант писать не собирался.
  let only: string[] | undefined;
  if (segment) {
    if (!isCrmSegment(segment)) return fail("segment_unknown");
    const { customers } = await readCompanyCustomers(promo.companyId, now);
    only = customers.filter((c) => inSegment(c, segment, now)).map((c) => c.userId);
  }

  const plan = planDeliveries(await recipientStates(promo.companyId, now, only));
  if (plan.followers === 0) return fail(segment ? "segment_empty" : "no_followers");

  const send = await prisma.promoSend.create({
    data: { promoId, senderUserId: userId, followers: plan.followers, segment: segment ?? null },
    select: { id: true },
  });

  const outcomes: { userId: string; outcome: SkipOutcome | "TELEGRAM" | "EMAIL" | "WEBPUSH" | "SKIPPED_NO_CHANNEL" }[] =
    plan.skip.map((s) => ({ userId: s.userId, outcome: s.outcome }));

  for (const recipientId of plan.send) {
    const message = await promoMessage(recipientId, {
      shop: promo.company.displayName,
      title: promo.title,
      body: promo.body,
      promoId: promo.id,
    });
    const result = await notifyUser({
      userId: recipientId,
      subject: `${promo.company.displayName}: ${promo.title}`,
      text: message.text,
      url: message.url,
    });
    const channel = result.delivered.includes("telegram")
      ? "TELEGRAM"
      : result.delivered.includes("email")
        ? "EMAIL"
        : result.delivered.includes("webpush")
          ? "WEBPUSH"
          : "SKIPPED_NO_CHANNEL";
    outcomes.push({ userId: recipientId, outcome: channel });
  }

  await prisma.promoDelivery.createMany({
    data: outcomes.map((o) => ({ sendId: send.id, userId: o.userId, outcome: o.outcome as never })),
  });
  const delivered = outcomes.filter((o) => !o.outcome.startsWith("SKIPPED")).length;
  await prisma.promoSend.update({
    where: { id: send.id },
    data: { delivered, skipped: outcomes.length - delivered },
  });
  await prisma.merchantPromo.update({ where: { id: promoId }, data: { sentAt: now } });
  await logCompanyAction({
    companyId: promo.companyId,
    actorUserId: userId,
    action: "PROMO_SENT",
    subject: promo.title,
    meta: { followers: plan.followers, delivered, skipped: outcomes.length - delivered, segment: segment ?? null },
  });
  revalidatePromo(promo.companyId, promo.product?.slug);
  return { ok: true as const, followers: plan.followers, delivered, skipped: outcomes.length - delivered };
}

/**
 * Текст сообщения. Акция идёт **как написана** — это утверждение продавца, и машинный
 * перевод скидки не лучше машинного перевода состава продукта (решение BB). Наша
 * обёртка — на языке кабинета получателя: прецедент письма сброса пароля.
 */
async function promoMessage(
  recipientId: string,
  promo: { shop: string; title: string; body: string; promoId: string },
) {
  const user = await prisma.user.findUnique({
    where: { id: recipientId },
    select: { preferredLocale: true },
  });
  const locale = user?.preferredLocale ?? "en";
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://trientes.org";
  const url = `${site}/${locale}/promo/${promo.promoId}`;
  const [header, openLine, unsubscribe] = await Promise.all([
    rawMessage(locale, "notify.promo.from", { shop: promo.shop }),
    rawMessage(locale, "notify.promo.open", { url }),
    rawMessage(locale, "notify.promo.unsubscribe", { url: `${site}/${locale}/cabinet/subscriptions` }),
  ]);
  return {
    url,
    text: `${header}\n\n${promo.title}\n${promo.body}\n\n${openLine}\n${unsubscribe}`,
  };
}
