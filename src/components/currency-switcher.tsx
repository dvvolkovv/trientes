"use client";

import { useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CURRENCIES, type Currency } from "@/lib/currency";
import { setCurrency } from "@/app/actions/currency";

export function CurrencySwitcher({ current }: { current: Currency }) {
  const [pending, start] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label="Currency"
          className="text-xs px-3 py-1.5 rounded-md font-medium uppercase tracking-wider bg-card text-muted border border-hairline hover:text-foreground transition-colors disabled:opacity-50"
        >
          {current}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {CURRENCIES.map((c) => (
          <DropdownMenuItem
            key={c}
            onClick={() => start(() => setCurrency(c).then(() => undefined))}
          >
            {c}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
