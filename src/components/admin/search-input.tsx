"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function AdminSearchInput({ placeholder }: { placeholder: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const [value, setValue] = useState(sp.get("q") ?? "");
  const [pending, start] = useTransition();
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        setValue(e.target.value);
        start(() => {
          const params = new URLSearchParams(sp);
          if (e.target.value) params.set("q", e.target.value);
          else params.delete("q");
          router.replace(`?${params.toString()}`);
        });
      }}
      className={`bg-card border border-hairline rounded-md px-3 py-2 text-sm w-full max-w-md placeholder:text-muted focus:ring-1 focus:ring-accent outline-none ${pending ? "opacity-50" : ""}`}
    />
  );
}
