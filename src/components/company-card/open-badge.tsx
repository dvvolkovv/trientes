"use client";

import { useTranslations } from "next-intl";
import type { OpenState } from "@/lib/opening-hours";

/**
 * Состояние «открыто сейчас» одной плашкой (слайс BY). Закрыто — красным, открыто —
 * зелёным, и то и другое непрозрачной подложкой: плашка стоит и поверх фотографии.
 *
 * Состояние считает сервер (`openStateAt`): часовой пояс магазина — не пояс браузера,
 * и второй разбор на этой стороне завёл бы вторую правду о том, открыто ли сейчас.
 */
export function CardOpenBadge({ state, compact = false }: { state: OpenState; compact?: boolean }) {
  const t = useTranslations("business.hours");
  if (!state.known) return null;
  const tone = state.open
    ? "border-[#30B658]/45 bg-[#0e2616]/92 text-[#30B658]"
    : "border-[#E55C5C]/45 bg-[#281010]/92 text-[#E55C5C]";
  const tail = state.open
    ? state.until
      ? ` · ${t("until", { time: state.until })}`
      : ""
    : state.opensAt
      ? ` · ${t("opensAt", { time: state.opensAt, day: t(`dayShort.${state.opensDay}`) })}`
      : "";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${tone}`}
    >
      <span aria-hidden className="text-[8px] leading-none">●</span>
      {state.open ? t("openNow") : t("closedNow")}
      {compact ? "" : tail}
    </span>
  );
}
