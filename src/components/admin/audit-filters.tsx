"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";

const ACTIONS = [
  "APPROVE_REQUEST",
  "REJECT_REQUEST",
  "ADD_COIN",
  "TOGGLE_COIN_ACTIVE",
  "SET_USER_ROLE",
] as const;

type Labels = {
  searchPlaceholder: string;
  allActions: string;
  apply: string;
  reset: string;
};

export function AuditFilters({ labels }: { labels: Labels }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [q, setQ] = useState(params.get("q") ?? "");
  const [action, setAction] = useState(params.get("action") ?? "");

  const apply = () => {
    const next = new URLSearchParams();
    if (q.trim()) next.set("q", q.trim());
    if (action) next.set("action", action);
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  };

  const reset = () => {
    setQ("");
    setAction("");
    startTransition(() => {
      router.push(pathname);
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      className="mb-6 flex flex-col md:flex-row gap-2"
    >
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={labels.searchPlaceholder}
        className="flex-1 bg-card border border-hairline rounded-[10px] px-4 py-2.5 text-sm focus:outline-none focus:border-accent"
      />
      <select
        value={action}
        onChange={(e) => setAction(e.target.value)}
        className="bg-card border border-hairline rounded-[10px] px-4 py-2.5 text-sm focus:outline-none focus:border-accent"
      >
        <option value="">{labels.allActions}</option>
        {ACTIONS.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-bg num text-[11px] uppercase tracking-[0.18em] font-medium px-5 py-2.5 rounded-[10px] disabled:opacity-50"
      >
        {labels.apply}
      </button>
      <button
        type="button"
        onClick={reset}
        disabled={pending}
        className="bg-card border border-hairline num text-[11px] uppercase tracking-[0.18em] font-medium px-5 py-2.5 rounded-[10px] disabled:opacity-50"
      >
        {labels.reset}
      </button>
    </form>
  );
}
