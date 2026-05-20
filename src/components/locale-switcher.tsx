"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "@/lib/locales";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("common");

  const setLocale = (next: string) => {
    const segments = pathname.split("/");
    segments[1] = next;
    router.push(segments.join("/"));
  };

  const label = LOCALE_LABELS[locale as keyof typeof LOCALE_LABELS] ?? locale;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("languageLabel")}
          className="text-xs px-3 py-1.5 rounded-md font-medium uppercase tracking-wider bg-card hover:bg-card-alt text-muted hover:text-foreground border border-hairline transition-colors inline-flex items-center gap-1.5"
        >
          {label}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {SUPPORTED_LOCALES.map((l) => (
          <DropdownMenuItem key={l} onClick={() => setLocale(l)}>
            {LOCALE_LABELS[l]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
