"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleCoinActive } from "@/app/actions/admin-coins";

export function CoinActiveToggle({ coinId, initialActive }: { coinId: string; initialActive: boolean }) {
  const [active, setActive] = useState(initialActive);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const next = !active;
        setActive(next);
        start(async () => {
          const res = await toggleCoinActive(coinId);
          if (!res.ok) {
            setActive(!next); // revert
          } else if (typeof res.isActive === "boolean") {
            setActive(res.isActive);
          }
          router.refresh();
        });
      }}
      className={`px-2 py-1 text-xs rounded ${
        active
          ? "bg-green-500/15 text-green-700 dark:text-green-400"
          : "bg-muted text-muted-foreground"
      } ${pending ? "opacity-50" : ""}`}
    >
      {active ? "Active" : "Disabled"}
    </button>
  );
}
