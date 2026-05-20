import { getTranslations } from "next-intl/server";

type LinkRow = { label: string; href: string | null };

export async function CoinLinks({ coin }: {
  coin: {
    websiteUrl: string | null;
    explorerUrl: string | null;
    whitepaperUrl: string | null;
    githubUrl: string | null;
    twitterUrl: string | null;
    redditUrl: string | null;
  };
}) {
  const t = await getTranslations("detail");
  const items: LinkRow[] = [
    { label: t("website"), href: coin.websiteUrl },
    { label: t("explorer"), href: coin.explorerUrl },
    { label: t("whitepaper"), href: coin.whitepaperUrl },
    { label: t("github"), href: coin.githubUrl },
    { label: t("twitter"), href: coin.twitterUrl },
    { label: t("reddit"), href: coin.redditUrl },
  ].filter((x) => x.href);

  if (items.length === 0) return null;

  return (
    <section>
      <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">
        Section
      </div>
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">
        {t("links")}
      </h2>
      <div className="flex flex-wrap gap-2">
        {items.map((l) => (
          <a
            key={l.label}
            href={l.href!}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm rounded-md bg-card border border-hairline text-foreground hover:bg-card-alt hover:border-muted transition-colors"
          >
            <span>{l.label}</span>
            <span aria-hidden>→</span>
          </a>
        ))}
      </div>
    </section>
  );
}
