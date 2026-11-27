/**
 * Смена канала связи замораживает ссылку оплаты на сутки (задание, § 2.6).
 *
 * Зачем: иначе захватчик аккаунта сначала меняет Telegram и почту на свои, и
 * отложенная смена ссылки проходит в полной тишине — весть о ней приходит ему же.
 * Поэтому штамп ставится у самой записи (`User.contactChangedAt`), его читает правило
 * `planPayLinkChange`, а **весть о смене канала уходит на старый канал**: это
 * единственное сообщение, которое обязано прийти туда, откуда канал только что убрали.
 *
 * Снимок старых каналов снимается **до** записи нового значения — иначе писать было бы
 * уже некуда.
 */
import { prisma } from "@/lib/prisma";
import { readChannels, sendToChannels, type PayChannels } from "@/lib/pay-link/channels";
import { rawMessage } from "@/lib/messages-raw";

export type ContactChannel = "email" | "telegram";

/** Каналы до правки. Зови перед записью нового значения. */
export async function channelsBeforeChange(userId: string): Promise<PayChannels> {
  return readChannels(userId);
}

/**
 * Поставить штамп и написать на старый канал. Сбой записи штампа глушить нельзя —
 * без него заморозки не будет, — но и ронять смену почты из-за него незачем: правка
 * профиля уже прошла, а штамп пишется отдельной строкой и падение видно в логе.
 */
export async function stampContactChange(input: {
  userId: string;
  channel: ContactChannel;
  before: PayChannels;
}): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: input.userId },
      data: { contactChangedAt: new Date() },
    });
  } catch (error) {
    console.error("contact_change_stamp_failed", input.userId, error);
  }
  if (input.before.chatId === null && input.before.email === null) return;
  const vars = { channel: input.channel };
  const [subject, text] = await Promise.all([
    rawMessage(input.before.locale, "payLink.notify.contactChanged.subject", vars),
    rawMessage(input.before.locale, `payLink.notify.contactChanged.body.${input.channel}`, vars),
  ]);
  await sendToChannels(input.before, { subject, text });
}
