import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listViewerCards } from "@/lib/coin-card-viewer";

export async function CoinsSection({ locale }: { locale: string }) {
  const t = await getTranslations("cabinet.coins");
  const { cards } = await listViewerCards();

  return (
    <section id="coins">
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h2>
      <p className="text-sm text-muted mb-4">{t("subtitle")}</p>

      {cards.length === 0 ? (
        <p className="text-sm text-muted">
          {t("empty")}{" "}
          <Link href={`/${locale}/request`} className="text-accent">
            {t("submitLink")}
          </Link>
        </p>
      ) : (
        <ul className="space-y-2">
          {cards.map((c) => (
            <li key={c.id}>
              <Link
                href={`/${locale}/cabinet/coins/${c.id}`}
                className="flex items-center gap-3 border border-hairline rounded-md px-3 py-2.5 hover:bg-card-alt"
              >
                <span className="font-medium">{c.name}</span>
                <span className="num text-xs text-muted">{c.symbol}</span>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded ${
                    c.status === "APPROVED"
                      ? "bg-green-500/15 text-green-500"
                      : c.status === "REJECTED"
                        ? "bg-red-500/15 text-red-500"
                        : "bg-yellow-500/15 text-yellow-500"
                  }`}
                >
                  {t(`status.${c.status}`)}
                </span>
                <span className="text-[11px] text-muted ml-auto">
                  {t("role", { role: c.members[0]?.role ?? "" })} · {c.completeness}%
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
