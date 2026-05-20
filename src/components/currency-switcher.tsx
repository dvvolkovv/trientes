"use client";

import { useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { CURRENCIES, type Currency } from "@/lib/currency";
import { setCurrency } from "@/app/actions/currency";

export function CurrencySwitcher({ current }: { current: Currency }) {
  const [pending, start] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending} aria-label="Currency">
          {current}
        </Button>
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
