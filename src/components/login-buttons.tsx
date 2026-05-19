"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { signInWithProvider } from "@/app/actions/auth";

export function LoginButtons() {
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
      <div className="mt-4 border rounded p-4">
        <p className="text-sm text-muted-foreground mb-2">
          Telegram login widget will mount here once TELEGRAM_BOT_USERNAME is set.
          For Phase 1 the widget script is wired in Task 15.
        </p>
      </div>
    </div>
  );
}
