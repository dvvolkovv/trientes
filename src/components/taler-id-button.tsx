"use client";

import Image from "next/image";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { signInWithProvider } from "@/app/actions/auth";

/**
 * «Продолжить через Taler ID» — и вход, и регистрация: при первом входе
 * аккаунт на сайте заводится сам. Цвета и размеры — из фирменной кнопки
 * Taler ID (https://talerid.io/brand/, тёмный вариант, 44 px).
 */
export function TalerIdButton() {
  const [pending, start] = useTransition();
  const t = useTranslations("register");
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => signInWithProvider("talerid"))}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#167EF2] bg-[#167EF2] px-4 text-sm font-semibold text-white transition-colors hover:border-[#1570D6] hover:bg-[#1570D6] disabled:opacity-50"
    >
      {/* У логотипа из brand-кита непрозрачный белый фон — круг делает из него значок. */}
      <Image src="/brand/taler-id.png" alt="" width={22} height={22} className="rounded-full" aria-hidden />
      {t("continueWithTalerId")}
    </button>
  );
}
