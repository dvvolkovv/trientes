import { getTranslations } from "next-intl/server";

const KEYS = ["website", "twitter", "telegram", "facebook", "github", "reddit", "youtube"] as const;

export async function ExchangeCardSocials({ socials }: { socials: Record<string, string> | null }) {
  if (!socials) return null;
  const present = KEYS.filter((k) => typeof socials[k] === "string" && socials[k]);
  if (present.length === 0) return null;
  const t = await getTranslations("exchangeCard");
  return (
    <section>
      <h2 className="text-[15px] font-semibold mb-3">{t("socials.title")}</h2>
      <ul className="flex flex-wrap gap-2">
        {present.map((k) => (
          <li key={k}>
            <a
              href={socials[k]}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="inline-flex items-center gap-2 bg-card border border-hairline rounded-md px-3 py-2 text-[13px] hover:bg-bg-tint"
            >
              <span className="capitalize">{k}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
