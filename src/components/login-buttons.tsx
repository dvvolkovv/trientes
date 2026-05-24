"use client";

import { useTransition } from "react";
import { signInWithProvider } from "@/app/actions/auth";
import { TelegramLogin } from "@/components/telegram-login";
import { PasswordLoginForm } from "@/components/password-login-form";

export function LoginButtons({
  locale,
  telegramBotUsername,
  next,
}: {
  locale: string;
  telegramBotUsername?: string;
  next?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-5">
      <PasswordLoginForm locale={locale} next={next} />
      <div className="relative flex items-center my-1">
        <div className="flex-grow border-t border-hairline" />
        <span className="px-3 text-[11px] uppercase tracking-[0.2em] text-muted">or</span>
        <div className="flex-grow border-t border-hairline" />
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => signInWithProvider("google"))}
        className="bg-blue text-blue-foreground rounded-full px-4 py-2.5 text-sm font-semibold uppercase tracking-wider hover:brightness-110 transition-all disabled:opacity-50"
      >
        Continue with Google
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => signInWithProvider("github"))}
        className="bg-card-alt text-foreground border border-hairline rounded-md px-4 py-2.5 text-sm font-medium transition-colors hover:bg-card disabled:opacity-50"
      >
        Continue with GitHub
      </button>
      {telegramBotUsername ? (
        <div className="pt-4 mt-2 border-t border-hairline">
          <TelegramLogin botUsername={telegramBotUsername} />
        </div>
      ) : null}
    </div>
  );
}
