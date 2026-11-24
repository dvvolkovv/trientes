/**
 * Куда можно отдать ссылку приглашения, когда у браузера нет своего окна
 * «поделиться».
 *
 * На телефоне всё решает `navigator.share`: системное окно сразу показывает
 * почту, сообщения, Telegram, WhatsApp, AirDrop — всё, что у человека стоит, и
 * заводить свой список приложений там незачем. Эти цели — для компьютера, где
 * системного окна нет: четыре явных ссылки вместо пустой кнопки.
 *
 * Чистый модуль: собирает только строки, поэтому правила кодирования накрыты
 * тестом, а не проверяются глазом на живом телефоне.
 */

export type ShareTargetKey = "email" | "sms" | "telegram" | "whatsapp";

export type SharePayload = {
  /** Тема письма. У остальных целей темы нет — там она не показывается. */
  title?: string;
  /** Пояснение своими словами; ссылка в него не входит. */
  text?: string;
  url: string;
};

export const SHARE_TARGETS: { key: ShareTargetKey; icon: string }[] = [
  { key: "email", icon: "✉" },
  { key: "sms", icon: "💬" },
  { key: "telegram", icon: "✈" },
  { key: "whatsapp", icon: "🟢" },
];

/** Текст одним куском: пояснение, затем ссылка с новой строки. */
export function shareMessage({ text, url }: SharePayload) {
  const body = (text ?? "").trim();
  return body ? `${body}\n${url}` : url;
}

export function shareTargetHref(key: ShareTargetKey, payload: SharePayload) {
  const message = shareMessage(payload);
  const title = (payload.title ?? "").trim();
  switch (key) {
    case "email": {
      const q = new URLSearchParams();
      if (title) q.set("subject", title);
      q.set("body", message);
      return `mailto:?${q.toString()}`;
    }
    case "sms":
      // `sms:?&body=` — запись, которую берут обе системы: iOS не понимает
      // `?body=`, Android не понимает `&body=` без знака вопроса.
      return `sms:?&body=${encodeURIComponent(message)}`;
    case "telegram": {
      const q = new URLSearchParams({ url: payload.url });
      // Ссылку Telegram подставляет сам из `url`; повтори её в `text` — и
      // получатель увидит адрес дважды.
      if (payload.text?.trim()) q.set("text", payload.text.trim());
      return `https://t.me/share/url?${q.toString()}`;
    }
    case "whatsapp":
      return `https://wa.me/?${new URLSearchParams({ text: message }).toString()}`;
  }
}
