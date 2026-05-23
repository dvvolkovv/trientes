import type { NewsItem, NewsTheme } from "@/lib/news";
import { timeAgo } from "@/lib/time";
import { NewsCardImage } from "@/components/news-card-image";

// Theme accents tuned for legibility on the dark ledger background. Kept as
// presentational hex (used via inline style) so Tailwind's purge can't drop
// runtime-built color classes.
const THEME: Record<NewsTheme, { label: string; color: string }> = {
  market: { label: "Market", color: "#fe5c04" },
  blockchain: { label: "Blockchain", color: "#5b8def" },
  regulation: { label: "Regulation", color: "#e55c5c" },
  tech: { label: "Tech", color: "#30b658" },
  general: { label: "General", color: "#a09baa" },
};

// Deterministic gradient angle per item so placeholder cards don't all look alike.
function hashAngle(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

// Branded fallback for feeds that carry no image (e.g. CoinDesk): a gradient
// tinted by the theme color, the source name centered over a faint "T" mark.
function MediaPlaceholder({ source, color, seed }: { source: string; color: string; seed: string }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: `linear-gradient(${hashAngle(seed)}deg, ${color}33, ${color}0d 55%, transparent)` }}
    >
      <span aria-hidden className="absolute font-black text-[88px] leading-none select-none" style={{ color, opacity: 0.08 }}>
        T
      </span>
      <span className="num text-[12px] uppercase tracking-[0.22em]" style={{ color }}>
        {source}
      </span>
    </div>
  );
}

export function NewsRail({
  items,
  locale,
  limit = 8,
}: {
  items: NewsItem[];
  locale: string;
  limit?: number;
}) {
  if (items.length === 0) return null;
  const shown = items.slice(0, limit);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-hairline rounded-[20px] overflow-hidden border border-hairline">
      {shown.map((item) => {
        const theme = THEME[item.theme] ?? THEME.general;
        const placeholder = <MediaPlaceholder source={item.source} color={theme.color} seed={item.url} />;
        return (
          <a
            key={item.url}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="group flex flex-col h-full bg-card hover:bg-bg-tint transition-colors"
          >
            <div className="relative aspect-[16/9] overflow-hidden bg-bg-tint">
              {item.imageUrl ? <NewsCardImage src={item.imageUrl} fallback={placeholder} /> : placeholder}
              <span
                className="absolute left-3 top-3 num text-[10px] font-semibold uppercase tracking-[0.16em] px-2 py-1 rounded-md backdrop-blur-sm"
                style={{ color: theme.color, backgroundColor: `${theme.color}26` }}
              >
                {theme.label}
              </span>
            </div>
            <div className="flex flex-col flex-1 p-6">
              <h3 className="flex-1 text-[15px] leading-[1.35] font-medium text-foreground group-hover:text-accent transition-colors line-clamp-3">
                {item.title}
              </h3>
              <div className="mt-5 flex items-center justify-between gap-2 num text-[11px] uppercase tracking-[0.14em] text-muted">
                <span className="flex items-center gap-1.5 truncate">
                  <span className="truncate">{item.source}</span>
                  <span aria-hidden className="text-accent opacity-0 group-hover:opacity-100 transition-opacity">↗</span>
                </span>
                <time
                  dateTime={new Date(item.publishedAt * 1000).toISOString()}
                  className="shrink-0 normal-case tracking-normal"
                >
                  {timeAgo(item.publishedAt, locale)}
                </time>
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
