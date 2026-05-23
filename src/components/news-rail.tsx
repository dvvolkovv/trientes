import type { NewsItem, NewsTheme } from "@/lib/news";
import { timeAgo } from "@/lib/time";

// Theme accents tuned for legibility on the dark ledger background. Kept as
// presentational hex (used via inline style) so Tailwind's purge can't drop
// runtime-built color classes.
const THEME: Record<NewsTheme, { label: string; color: string }> = {
  market: { label: "Market", color: "#f7931a" },
  blockchain: { label: "Blockchain", color: "#5b8def" },
  regulation: { label: "Regulation", color: "#e55c5c" },
  tech: { label: "Tech", color: "#30b658" },
  general: { label: "General", color: "#a09baa" },
};

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
        return (
          <a
            key={item.url}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="group flex flex-col h-full bg-card p-6 hover:bg-bg-tint transition-colors"
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className="num text-[10px] font-semibold uppercase tracking-[0.16em] px-2 py-1 rounded-md"
                style={{ color: theme.color, backgroundColor: `${theme.color}1f` }}
              >
                {theme.label}
              </span>
              <time
                dateTime={new Date(item.publishedAt * 1000).toISOString()}
                className="num text-[11px] text-muted shrink-0"
              >
                {timeAgo(item.publishedAt, locale)}
              </time>
            </div>
            <h3 className="mt-4 flex-1 text-[15px] leading-[1.35] font-medium text-foreground group-hover:text-accent transition-colors line-clamp-3">
              {item.title}
            </h3>
            <div className="mt-5 flex items-center gap-1.5 num text-[11px] uppercase tracking-[0.14em] text-muted">
              <span>{item.source}</span>
              <span aria-hidden className="text-accent opacity-0 group-hover:opacity-100 transition-opacity">↗</span>
            </div>
          </a>
        );
      })}
    </div>
  );
}
