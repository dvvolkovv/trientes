"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { editorCompany } from "@/lib/products/editor-company";
import { can } from "@/lib/company-team/permissions";
import { logCompanyAction } from "@/lib/company-team/journal";
import { MAX_RULES, validateRule, type RuleInput } from "@/lib/automation/rules";
import { automationKeyConfigured, sealWebhookSecret } from "@/lib/automation/secret";
import {
  MAX_WEBHOOKS,
  generateWebhookSecret,
  parseWebhookEvents,
  webhookUrlReason,
} from "@/lib/automation/webhooks";

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

/**
 * Калитка раздела: право `automation: EDIT`. Читает её и экран, и действие — экран без
 * действия защитой не является (дыра, которую живой прогон BA нашёл у
 * `startMfaEnrollment`).
 */
async function editorGate(companyId: string) {
  const userId = await requireUser();
  if (!userId) return { userId: null as string | null, gate: null };
  const gate = await editorCompany(companyId, userId);
  if (!gate || !can(gate.permissions, "automation", "EDIT")) return { userId, gate: null };
  return { userId, gate };
}

/** Webhook выдаёт и отзывает только владелец: данные уходят наружу (решение CL). */
async function ownerGate(companyId: string) {
  const userId = await requireUser();
  if (!userId) return { userId: null as string | null, gate: null };
  const gate = await editorCompany(companyId, userId);
  if (!gate || gate.role !== "OWNER") return { userId, gate: null };
  return { userId, gate };
}

function touch(companyId: string) {
  revalidatePath(`/[locale]/cabinet/companies/${companyId}/automation`, "page");
}

export async function saveRule(companyId: string, ruleId: string | null, input: RuleInput) {
  const { userId, gate } = await editorGate(companyId);
  if (!userId) return fail("unauth");
  if (!gate) return fail("forbidden");

  // Потолок считается только у нового правила: правка живого правила его не добавляет.
  const ruleCount = ruleId ? 0 : await prisma.companyRule.count({ where: { companyId } });
  const parsed = validateRule(input, { ruleCount });
  if (!parsed.ok) return fail(parsed.reason);
  const value = parsed.value;

  const data = {
    name: value.name,
    trigger: value.trigger,
    action: value.action,
    conditions: value.conditions as Prisma.InputJsonValue,
    params: value.params as unknown as Prisma.InputJsonValue,
  };

  if (ruleId) {
    const owned = await prisma.companyRule.count({ where: { id: ruleId, companyId } });
    if (owned === 0) return fail("not_found");
    await prisma.companyRule.update({ where: { id: ruleId }, data });
  } else {
    await prisma.companyRule.create({ data: { ...data, companyId, createdById: userId } });
  }

  await logCompanyAction({
    companyId,
    actorUserId: userId,
    action: "RULE_SAVED",
    subject: value.name,
    meta: { trigger: value.trigger, action: value.action },
  });
  touch(companyId);
  return { ok: true as const };
}

export async function setRuleEnabled(companyId: string, ruleId: string, enabled: boolean) {
  const { userId, gate } = await editorGate(companyId);
  if (!userId) return fail("unauth");
  if (!gate) return fail("forbidden");
  const rule = await prisma.companyRule.findFirst({ where: { id: ruleId, companyId }, select: { name: true } });
  if (!rule) return fail("not_found");
  await prisma.companyRule.update({ where: { id: ruleId }, data: { enabled } });
  await logCompanyAction({
    companyId,
    actorUserId: userId,
    action: "RULE_TOGGLED",
    subject: rule.name,
    meta: { enabled },
  });
  touch(companyId);
  return { ok: true as const };
}

/**
 * Удаление правила. Строки срабатываний уходят вместе с ним (`Cascade`): они объясняют
 * **это** правило, и без него необъяснимы; поставленные задачи остаются — работа была
 * настоящей.
 */
export async function deleteRule(companyId: string, ruleId: string) {
  const { userId, gate } = await editorGate(companyId);
  if (!userId) return fail("unauth");
  if (!gate) return fail("forbidden");
  const rule = await prisma.companyRule.findFirst({ where: { id: ruleId, companyId }, select: { name: true } });
  if (!rule) return fail("not_found");
  await prisma.companyRule.delete({ where: { id: ruleId } });
  await logCompanyAction({ companyId, actorUserId: userId, action: "RULE_DELETED", subject: rule.name });
  touch(companyId);
  return { ok: true as const };
}

/**
 * Заведение адреса оповещений. Секрет показывается **один раз** — повторно его не
 * узнать (прецеденты: ключ API в CL, ссылка чека в CK, приглашение сотрудника в AS).
 */
export async function createWebhook(companyId: string, input: { url: string; events: string[] }) {
  const { userId, gate } = await ownerGate(companyId);
  if (!userId) return fail("unauth");
  if (!gate) return fail("forbidden");
  if (!automationKeyConfigured()) return fail("not_configured");

  const urlReason = webhookUrlReason(input.url);
  if (urlReason) return fail(urlReason);
  const events = parseWebhookEvents(input.events);
  if (events.length === 0) return fail("events_required");

  const live = await prisma.companyWebhook.count({ where: { companyId } });
  if (live >= MAX_WEBHOOKS) return fail("too_many");

  const secret = generateWebhookSecret();
  await prisma.companyWebhook.create({
    data: {
      companyId,
      url: input.url.trim(),
      events,
      secretSealed: sealWebhookSecret(secret),
      createdById: userId,
    },
  });
  await logCompanyAction({
    companyId,
    actorUserId: userId,
    action: "WEBHOOK_CREATED",
    subject: input.url.trim(),
    meta: { events },
  });
  touch(companyId);
  return { ok: true as const, secret };
}

export async function setWebhookEnabled(companyId: string, webhookId: string, enabled: boolean) {
  const { userId, gate } = await ownerGate(companyId);
  if (!userId) return fail("unauth");
  if (!gate) return fail("forbidden");
  const hook = await prisma.companyWebhook.findFirst({
    where: { id: webhookId, companyId },
    select: { url: true },
  });
  if (!hook) return fail("not_found");
  await prisma.companyWebhook.update({ where: { id: webhookId }, data: { enabled } });
  await logCompanyAction({
    companyId,
    actorUserId: userId,
    action: "WEBHOOK_TOGGLED",
    subject: hook.url,
    meta: { enabled },
  });
  touch(companyId);
  return { ok: true as const };
}

export async function deleteWebhook(companyId: string, webhookId: string) {
  const { userId, gate } = await ownerGate(companyId);
  if (!userId) return fail("unauth");
  if (!gate) return fail("forbidden");
  const hook = await prisma.companyWebhook.findFirst({
    where: { id: webhookId, companyId },
    select: { url: true },
  });
  if (!hook) return fail("not_found");
  await prisma.companyWebhook.delete({ where: { id: webhookId } });
  await logCompanyAction({ companyId, actorUserId: userId, action: "WEBHOOK_DELETED", subject: hook.url });
  touch(companyId);
  return { ok: true as const };
}
