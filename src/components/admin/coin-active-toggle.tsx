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
      className={
        active
          ? `bg-up/15 text-up px-3 py-1.5 text-xs uppercase tracking-wider rounded-md font-medium hover:bg-up/25 transition-colors ${pending ? "opacity-50" : ""}`
          : `bg-card-alt text-muted px-3 py-1.5 text-xs uppercase tracking-wider rounded-md font-medium hover:bg-card-alt/80 transition-colors ${pending ? "opacity-50" : ""}`
      }
    >
      {active ? "Active" : "Disabled"}
    </button>
  );
}
