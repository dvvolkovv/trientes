/**
 * Каналы владельца и отправка им вестей о ссылке оплаты.
 *
 * Обычные уведомления проекта идут через `notifyUser` — он читает каналы **сейчас**.
 * Здесь этого мало: отложенная смена исполняется через сутки, и задание прямо требует
 * слать весть на каналы **момента запроса** (§ 2.6). Иначе захватчик, сменивший за эти
 * сутки почту на свою, получил бы сообщение о своей же подмене, а владелец — ничего.
 * Поэтому снимок каналов снимается при запросе и хранится у ожидающей смены.
 *
 * В Telegram всё уходит **без `parse_mode`** (так уже шлёт `sendTelegram`): в тексте
 * стоит имя магазина, которое задал владелец ссылки, и разметка из его имени не должна
 * ничего значить (§ 2.8).
 */
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { sendTelegram } from "@/lib/notify";
import { pickLocale } from "@/lib/locales";

export type PayChannels = {
  /** Чат Telegram, если он привязан и человек не отключил канал. */
  chatId: string | null;
  /** Подтверждённая почта, если канал не отключён: на неподтверждённую не пишем. */
  email: string | null;
  /** Язык кабинета получателя: текст прочитает он, а не тот, кто нажал (прецедент AO). */
  locale: string;
};

export const EMPTY_CHANNELS: PayChannels = { chatId: null, email: null, locale: "en" };

/** Каналы человека сейчас. */
export async function readChannels(userId: string): Promise<PayChannels> {
  const [user, account] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true, emailVerified: true, preferredLocale: true,
        notifyTelegram: true, notifyEmail: true,
      },
    }),
    prisma.account.findFirst({
      where: { userId, provider: "telegram" },
      select: { providerAccountId: true },
    }),
  ]);
  if (!user) return EMPTY_CHANNELS;
  return {
    chatId: user.notifyTelegram ? (account?.providerAccountId ?? null) : null,
    email: user.notifyEmail && user.email && user.emailVerified ? user.email : null,
    locale: pickLocale(user.preferredLocale),
  };
}

/** Есть ли куда писать: от этого зависит, разрешена ли смена существующей ссылки. */
export const hasAnyChannel = (c: PayChannels): boolean => c.chatId !== null || c.email !== null;

/** Разбор снимка каналов из JSONB. Негодная строка читается как «каналов нет». */
export function parseChannels(raw: unknown): PayChannels {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_CHANNELS;
  const row = raw as Record<string, unknown>;
  return {
    chatId: typeof row.chatId === "string" ? row.chatId : null,
    email: typeof row.email === "string" ? row.email : null,
    locale: pickLocale(row.locale),
  };
}

/**
 * Отправка по снимку каналов. Сбой канала работу не роняет и не отменяет саму смену:
 * весть дороже тишины, но ссылка уже решена (прецеденты `logCompanyAction`, `ensureCase`).
 */
export async function sendToChannels(
  channels: PayChannels,
  input: { subject: string; text: string },
): Promise<void> {
  if (channels.chatId) {
    const r = await sendTelegram(channels.chatId, `${input.subject}\n\n${input.text}`);
    if (!r.ok) console.error("pay_link_telegram_failed", r.reason);
  }
  if (channels.email) {
    const r = await sendEmail({ to: channels.email, subject: input.subject, text: input.text });
    if (!r.ok) console.error("pay_link_email_failed", r.reason);
  }
}
