"use client";

import { useTransition } from "react";
import { signInWithProvider } from "@/app/actions/auth";
import { TelegramLogin } from "@/components/telegram-login";

export function LoginButtons({ telegramBotUsername }: { telegramBotUsername?: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
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
