import { normalizeHttpUrl } from "@/lib/coin-card-validate";

/**
 * Re-sanitizes on render. A URL that passed validation at write time must
 * still never become `javascript:` in an href — same defence-in-depth as the
 * POI mapper applies to company socials.
 */
export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string | null | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  const safe = normalizeHttpUrl(href);
  if (!safe || safe === "invalid") return null;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className={className}>
      {children}
    </a>
  );
}
