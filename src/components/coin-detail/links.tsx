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
      <h2 className="text-lg font-semibold mb-3">{t("links")}</h2>
      <div className="flex flex-wrap gap-2">
        {items.map((l) => (
          <a
            key={l.label}
            href={l.href!}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted"
          >
            {l.label} →
          </a>
        ))}
      </div>
    </section>
  );
}
