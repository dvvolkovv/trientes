"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptProjectInvite } from "@/app/actions/project-invites";
import { ADMIN_BUTTON } from "@/lib/admin-ui";

export function AcceptProjectInvite({
  token,
  locale,
  labels,
}: {
  token: string;
  locale: string;
  labels: { accept: string; accepted: string; errors: Record<string, string> };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        disabled={pending || done}
        className={ADMIN_BUTTON}
        onClick={() =>
          start(async () => {
            const res = await acceptProjectInvite({ token, locale });
            if (!res.ok) {
              setError(labels.errors[res.reason] ?? labels.errors.failed);
              return;
            }
            setDone(true);
            router.push(res.href);
          })
        }
      >
        {labels.accept}
      </button>
      {error ? <p className="text-[12px] leading-snug text-down">{error}</p> : null}
      {done ? <p className="text-[12px] text-up">{labels.accepted}</p> : null}
    </div>
  );
}
