"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Portal needs document.body — only available after mount on the client.
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const drawer = open && (
    <>
      <div
        className="md:hidden fixed inset-0 bg-black/60 z-40"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div
        className="md:hidden fixed left-0 top-0 h-screen w-80 max-w-[85vw] bg-bg-tint border-r border-hairline z-50 p-6 overflow-y-auto flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
          className="absolute top-4 right-4 inline-flex items-center justify-center w-9 h-9 rounded-md text-muted hover:text-foreground hover:bg-card-alt transition-colors"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div
          className="flex flex-col flex-1"
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest("a") || target.closest("button")) {
              setOpen(false);
            }
          }}
        >
          {children}
        </div>
      </div>
    </>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-md text-muted hover:text-foreground hover:bg-card-alt transition-colors"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* Portal the drawer to document.body so the sticky-header's
          backdrop-filter doesn't create a containing block that clips
          our h-screen fixed-position drawer. */}
      {mounted && drawer ? createPortal(drawer, document.body) : null}
    </>
  );
}
