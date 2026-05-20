"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

export function AdminSearchInput({ placeholder }: { placeholder: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const [value, setValue] = useState(sp.get("q") ?? "");
  const [pending, start] = useTransition();
  return (
    <Input
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
      className={`max-w-sm ${pending ? "opacity-50" : ""}`}
    />
  );
}
