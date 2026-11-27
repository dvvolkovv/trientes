/**
 * Два прогона воркера (задание, § 2.9 и § 2.6).
 *
 * **Суточная проверка.** Раз в сутки спрашиваем службу о каждой сохранённой ссылке:
 * 404 — кнопку «Оплатить» скрываем и пишем владельцу; `accepting: false` — пометка
 * владельцу, кнопку не трогаем (выключенную ссылку страница оплаты объяснит сама);
 * номер магазина не совпал с закреплённым — скрываем кнопку и поднимаем тревогу.
 * Молчание службы прежние числа **не стирает**: сбой связи — не повод снять кнопку.
 *
 * **Исполнение отложенной смены.** В назначенный час спрашиваем службу снова и только
 * тогда включаем: за сутки ссылку могли выключить или убрать. Весть уходит на каналы
 * **момента запроса**, а не момента исполнения.
 */
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";
import { fetchPayLink, type LinkOutcome } from "@/lib/pay-link/service";
import { parseChannels } from "@/lib/pay-link/channels";
import {
  logPayChange,
  notifyOwners,
  payPageUrl,
  sendMessage,
} from "@/lib/pay-link/store";

export type SweepStats = {
  checked: number;
  ok: number;
  disabled: number;
  hidden: number;
  mismatched: number;
  later: number;
};

type Fetcher = (linkId: string) => Promise<LinkOutcome>;

/**
 * Что суточная проверка делает с ответом службы — чистое правило, чтобы его можно было
 * проверить тестом (сам обход ходит в базу и шлёт вести).
 *
 * `later` стоит отдельно от остальных нарочно: это **сбой связи**, а не приговор
 * ссылке, и прежние числа по нему не меняются — иначе молчащая служба погасила бы
 * кнопки всех магазинов разом (правило семьи Bitcoin в слайсе Y).
 */
export type SweepVerdict = "ok" | "disabled" | "hidden" | "mismatch" | "later";

export function sweepVerdict(outcome: LinkOutcome, pinnedMerchantId: string): SweepVerdict {
  if (outcome.kind === "later") return "later";
  if (outcome.kind === "missing") return "hidden";
  if (outcome.kind === "off") return "disabled";
  // Закреплённый номер магазина сменился — так быть не должно ни при каких правках в
  // кабинете: номер ссылки принадлежит одному магазину.
  return outcome.info.merchantId === pinnedMerchantId ? "ok" : "mismatch";
}

const defaultFetcher: Fetcher = (linkId) => fetchPayLink(linkId);

/** Тревога владельцам платформы: закреплённый номер магазина не должен меняться. */
async function raiseAlarm(companyId: string, linkId: string, was: string, now: string): Promise<void> {
  console.error("pay_link_merchant_mismatch", companyId, linkId, was, now);
  const staff = await prisma.user.findMany({
    where: { role: { in: ["OWNER", "ADMIN"] } },
    select: { id: true },
  });
  for (const row of staff) {
    await notifyUser({
      userId: row.id,
      subject: "Pay link merchant mismatch",
      text:
        `Pay link ${linkId} of company ${companyId} now reports merchant ${now}, ` +
        `pinned was ${was}. The Pay button is hidden. This should never happen — ` +
        `check with the payment service.`,
    }).catch(() => {});
  }
}

export async function runPayLinkSweep(
  opts: { fetcher?: Fetcher; take?: number } = {},
): Promise<SweepStats> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const links = await prisma.companyPayLink.findMany({
    orderBy: { checkedAt: "asc" },
    take: opts.take ?? 500,
    select: { companyId: true, linkId: true, merchantId: true, merchantName: true, disabledAt: true, hiddenAt: true },
  });
  const stats: SweepStats = { checked: 0, ok: 0, disabled: 0, hidden: 0, mismatched: 0, later: 0 };
  const now = new Date();

  for (const link of links) {
    stats.checked += 1;
    const outcome = await fetcher(link.linkId);
    const verdict = sweepVerdict(outcome, link.merchantId);

    if (verdict === "later") {
      // Сбой связи прежние числа не трогает: иначе молчащая служба гасила бы кнопки
      // всех магазинов разом (правило семьи Bitcoin — «прежние числа остаются»).
      stats.later += 1;
      continue;
    }

    if (verdict === "hidden") {
      stats.hidden += 1;
      if (link.hiddenAt === null) {
        await prisma.companyPayLink.update({
          where: { companyId: link.companyId },
          data: { hiddenAt: now, hiddenReason: "missing", checkedAt: now },
        });
        await logPayChange({
          companyId: link.companyId,
          action: "HIDDEN",
          before: { linkId: link.linkId, merchantId: link.merchantId },
          note: "missing",
        });
        await notifyOwners(link.companyId, "missing", { merchant: link.merchantName });
      } else {
        await prisma.companyPayLink.update({
          where: { companyId: link.companyId },
          data: { checkedAt: now },
        });
      }
      continue;
    }

    if (verdict === "disabled") {
      stats.disabled += 1;
      if (link.disabledAt === null) {
        await prisma.companyPayLink.update({
          where: { companyId: link.companyId },
          data: { disabledAt: now, checkedAt: now },
        });
        await logPayChange({
          companyId: link.companyId,
          action: "DISABLED",
          before: { linkId: link.linkId, merchantId: link.merchantId },
        });
        await notifyOwners(link.companyId, "disabled", { merchant: link.merchantName });
      } else {
        await prisma.companyPayLink.update({ where: { companyId: link.companyId }, data: { checkedAt: now } });
      }
      continue;
    }

    if (verdict === "mismatch" && outcome.kind === "ok") {
      stats.mismatched += 1;
      await prisma.companyPayLink.update({
        where: { companyId: link.companyId },
        data: { hiddenAt: now, hiddenReason: "merchant_mismatch", checkedAt: now },
      });
      await logPayChange({
        companyId: link.companyId,
        action: "HIDDEN",
        before: { linkId: link.linkId, merchantId: link.merchantId },
        after: { linkId: link.linkId, merchantId: outcome.info.merchantId },
        note: "merchant_mismatch",
      });
      await notifyOwners(link.companyId, "mismatch", { merchant: link.merchantName });
      await raiseAlarm(link.companyId, link.linkId, link.merchantId, outcome.info.merchantId);
      continue;
    }

    if (outcome.kind !== "ok") continue;
    stats.ok += 1;
    await prisma.companyPayLink.update({
      where: { companyId: link.companyId },
      data: {
        merchantName: outcome.info.merchant,
        title: outcome.info.title === "" ? null : outcome.info.title,
        unit: outcome.info.unit,
        coinSymbol: outcome.info.coinSymbol,
        amount: outcome.info.amount,
        checkedAt: now,
        // Ссылка снова принимает — пометки снимаем: проверка на то и суточная.
        disabledAt: null,
        hiddenAt: null,
        hiddenReason: null,
      },
    });
  }
  return stats;
}

export type DueStats = { due: number; applied: number; cancelled: number; waiting: number };

/** Исполнение отложенных смен, у которых вышел срок. */
export async function runPayLinkDueSweep(
  opts: { fetcher?: Fetcher; now?: Date } = {},
): Promise<DueStats> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const now = opts.now ?? new Date();
  const rows = await prisma.companyPayLinkPending.findMany({
    where: { effectiveAt: { lte: now } },
    take: 200,
  });
  const stats: DueStats = { due: rows.length, applied: 0, cancelled: 0, waiting: 0 };

  for (const row of rows) {
    const outcome = await fetcher(row.linkId);
    const channels = parseChannels(row.notifyChannels);

    if (outcome.kind === "later") {
      // Служба молчит — ждём следующего прогона: включать то, чего мы не подтвердили,
      // нельзя, а отменять просьбу владельца из-за чужого сбоя — тем более.
      stats.waiting += 1;
      continue;
    }

    if (outcome.kind !== "ok" || outcome.info.merchantId !== row.merchantId) {
      stats.cancelled += 1;
      await prisma.companyPayLinkPending.delete({ where: { id: row.id } });
      await logPayChange({
        companyId: row.companyId,
        action: "CANCELLED",
        after: { linkId: row.linkId, merchantId: row.merchantId },
        note: outcome.kind === "ok" ? "merchant_mismatch" : outcome.kind,
      });
      await sendMessage(channels, "changeFailed", {
        merchant: row.merchantName,
        link: payPageUrl(channels.locale, row.companyId),
      });
      continue;
    }

    const before = await prisma.companyPayLink.findUnique({ where: { companyId: row.companyId } });
    const fields = {
      linkId: row.linkId,
      merchantId: outcome.info.merchantId,
      merchantName: outcome.info.merchant,
      title: outcome.info.title === "" ? null : outcome.info.title,
      unit: outcome.info.unit,
      coinSymbol: outcome.info.coinSymbol,
      amount: outcome.info.amount,
      checkedAt: now,
      disabledAt: null,
      hiddenAt: null,
      hiddenReason: null,
    };
    await prisma.$transaction([
      prisma.companyPayLink.upsert({
        where: { companyId: row.companyId },
        create: { companyId: row.companyId, ...fields, installedById: row.requestedById },
        update: { ...fields, installedById: row.requestedById },
      }),
      prisma.companyPayLinkPending.delete({ where: { id: row.id } }),
    ]);
    await logPayChange({
      companyId: row.companyId,
      action: "APPLIED",
      before: before ? { linkId: before.linkId, merchantId: before.merchantId } : null,
      after: { linkId: row.linkId, merchantId: outcome.info.merchantId },
      actor: { userId: row.requestedById, ip: null, userAgent: null },
    });
    await sendMessage(channels, "applied", {
      merchant: outcome.info.merchant,
      merchantId: outcome.info.merchantId,
      link: payPageUrl(channels.locale, row.companyId),
    });
    stats.applied += 1;
  }
  return stats;
}
