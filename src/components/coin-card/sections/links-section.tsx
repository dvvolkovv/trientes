import { getTranslations } from "next-intl/server";
import { ExternalLink } from "../external-link";

const ORDER = [
  "website", "docs", "whitepaper", "github", "x",
  "telegram", "discord", "reddit", "blog", "youtube",
] as const;

export async function CardLinksSection({ links }: { links: unknown }) {
  const t = await getTranslations("coinCard");
  const d = (links ?? {}) as Record<string, string>;
  const present = ORDER.filter((k) => d[k]);
  if (present.length === 0) return null;

  return (
    <section id="card-links" className="scroll-mt-24">
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">
        {t("sections.links")}
      </h2>
      <ul className="flex flex-wrap gap-3">
        {present.map((k) => (
          <li key={k}>
            <ExternalLink
              href={d[k]}
              className="inline-block border border-hairline rounded-md px-3 py-1.5 text-sm hover:border-accent hover:text-accent transition-colors"
            >
              {t(`links.${k}`)}
            </ExternalLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
