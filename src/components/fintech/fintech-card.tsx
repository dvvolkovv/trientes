import Link from "next/link";
import { getTranslations } from "next-intl/server";

export type FintechCardData = {
  id: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  description: string | null;
  services: string[];
  countryCode: string | null;
};

export async function FintechCard({ row, locale }: { row: FintechCardData; locale: string }) {
  const t = await getTranslations("fintech");
  return (
    <Link
      href={`/${locale}/fintech/${row.slug}`}
      className="block rounded-2xl border border-hairline bg-card p-5 transition hover:bg-card/80 hover:border-accent/40"
    >
      <div className="flex items-center gap-3">
        {row.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.logoUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
        ) : (
          <div className="h-12 w-12 rounded-lg bg-muted/20" />
        )}
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{row.displayName}</h3>
          {row.countryCode ? (
            <p className="num text-[11px] uppercase tracking-[0.2em] text-muted">{row.countryCode}</p>
          ) : null}
        </div>
      </div>
      {row.description ? (
        <p className="mt-3 line-clamp-2 text-sm text-muted">{row.description}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-1">
        {row.services.slice(0, 4).map((s) => (
          <span key={s} className="rounded-md bg-bg/60 px-2 py-0.5 text-[11px] text-muted border border-hairline">
            {t(`services.${s}`)}
          </span>
        ))}
        {row.services.length > 4 ? (
          <span className="text-[11px] text-muted">+{row.services.length - 4}</span>
        ) : null}
      </div>
    </Link>
  );
}
