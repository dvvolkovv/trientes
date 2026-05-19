"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { signInWithProvider } from "@/app/actions/auth";
import { TelegramLogin } from "@/components/telegram-login";

export function LoginButtons({ telegramBotUsername }: { telegramBotUsername?: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <Button
        disabled={pending}
        onClick={() => start(() => signInWithProvider("google"))}
      >
        Continue with Google
      </Button>
      <Button
        disabled={pending}
        onClick={() => start(() => signInWithProvider("github"))}
      >
        Continue with GitHub
      </Button>
      {telegramBotUsername ? (
        <div className="flex justify-center pt-2">
          <TelegramLogin botUsername={telegramBotUsername} />
        </div>
      ) : null}
    </div>
  );
}
