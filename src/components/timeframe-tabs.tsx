"use client";

import { Button } from "@/components/ui/button";

const FRAMES: Array<{ key: string; label: string }> = [
  { key: "1d", label: "1D" },
  { key: "7d", label: "7D" },
  { key: "1m", label: "1M" },
  { key: "1y", label: "1Y" },
  { key: "all", label: "All" },
];

export function TimeframeTabs({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex gap-1">
      {FRAMES.map((f) => (
        <Button
          key={f.key}
          variant={value === f.key ? "default" : "outline"}
          size="sm"
          onClick={() => onChange(f.key)}
        >
          {f.label}
        </Button>
      ))}
    </div>
  );
}
