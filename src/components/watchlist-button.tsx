"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toggleWatchlist } from "@/app/actions/watchlist";

type Size = "sm" | "md";

export function WatchlistButton({
  coinId,
  initialWatched,
  isAuthed,
  locale,
  size = "sm",
}: {
  coinId: string;
  initialWatched: boolean;
  isAuthed: boolean;
  locale: string;
  size?: Size;
}) {
  const [watched, setWatched] = useState(initialWatched);
  const [pending, start] = useTransition();
  const router = useRouter();
  const t = useTranslations("watchlist");

  const dims = size === "sm" ? "h-4 w-4" : "h-6 w-6";

  return (
    <button
      type="button"
      aria-label={watched ? t("removeFromWatchlist") : t("addToWatchlist")}
      disabled={pending}
      onClick={(e) => {
        // Prevent the row-level <Link> from navigating when star is clicked.
        e.stopPropagation();
        e.preventDefault();
        if (!isAuthed) {
          router.push(`/${locale}/login`);
          return;
        }
        // Optimistic
        const next = !watched;
        setWatched(next);
        start(async () => {
          const res = await toggleWatchlist(coinId);
          if (!res.ok) {
            // revert on error
            setWatched(!next);
          } else if (res.watched !== undefined) {
            setWatched(res.watched);
          }
        });
      }}
      className={`inline-flex items-center justify-center transition-colors ${watched ? "text-accent" : "text-muted hover:text-foreground"} ${pending ? "opacity-50" : ""}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill={watched ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={dims}
        aria-hidden="true"
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </button>
  );
}
