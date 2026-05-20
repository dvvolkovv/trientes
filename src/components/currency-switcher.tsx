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
          className="text-xs px-3 py-1.5 rounded-md font-medium uppercase tracking-wider bg-card hover:bg-card-alt text-muted hover:text-foreground border border-hairline transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {current}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="6 9 12 15 18 9" />
          </svg>
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
