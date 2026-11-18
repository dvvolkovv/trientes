import Link from "next/link";
import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NOT_DELETED } from "@/lib/soft-delete";
import { claimBlockedBy, claimPrefillFromTags } from "@/lib/point-claim";
import { isOsmPoiKey, osmKeyToPoiId } from "@/lib/osm-key";
import { ClaimPointForm } from "@/components/business/claim-point-form";

export const dynamic = "force-dynamic";

/**
 * «Это моё предприятие» — страница, на которую ведёт кнопка из карточки точки
 * навигатора. Всё, что здесь показано о месте, прочитано из нашего зеркала
 * BTC Map: заявитель видит ровно то, что получит в кабинете, и не вписывает
 * ничего руками.
 */
export default async function ClaimPointPage({
  params,
}: {
  params: Promise<{ locale: string; poiId: string }>;
}) {
  const { locale, poiId } = await params;
  setRequestLocale(locale);
  const osmKey = decodeURIComponent(poiId);
  if (!isOsmPoiKey(osmKey)) notFound();

  const t = await getTranslations("claimPoint");

  const mirror = await prisma.osmCryptoPoi.findUnique({
    where: { id: osmKey },
    select: { lat: true, lon: true, tags: true },
  });
  if (!mirror) notFound();

  const pre = claimPrefillFromTags((mirror.tags ?? {}) as Record<string, string>);
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const next = `/${locale}/claim/${encodeURIComponent(osmKey)}`;

  const [existing, companies] = await Promise.all([
    prisma.companyPoint.findMany({
      where: { osmId: osmKey },
      select: { status: true, deletedAt: true },
    }),
    userId
      ? prisma.companyMember.findMany({
          where: { userId, role: { in: ["OWNER", "EDITOR"] }, company: NOT_DELETED },
          select: { company: { select: { id: true, displayName: true } } },
          orderBy: { company: { displayName: "asc" } },
        })
      : Promise.resolve([]),
  ]);
  const blocked = claimBlockedBy(existing);

  const address = [pre.street, pre.houseNumber].filter(Boolean).join(" ");
  const cityLine = [pre.postalCode, pre.city].filter(Boolean).join(" ");
  const mapHref = `/${locale}/crypto-map?point=${encodeURIComponent(osmKeyToPoiId(osmKey) ?? "")}`;

  return (
    <main className="max-w-md mx-auto px-6 py-10 md:py-20">
      <div className="num text-[11px] uppercase tracking-[0.3em] text-accent mb-4">● {t("kicker")}</div>
      <h1 className="text-[28px] md:text-[40px] font-bold tracking-[-0.03em] mb-2">{t("title")}</h1>
      <p className="text-muted mb-8">{t("subtitle")}</p>

      <section className="bg-card border border-hairline rounded-[20px] p-6 mb-6 space-y-2">
        <div className="text-[18px] font-medium">{pre.name || t("unnamed")}</div>
        {(address || cityLine) && (
          <div className="text-[13px] text-muted">{[address, cityLine].filter(Boolean).join(", ")}</div>
        )}
        <div className="num text-[12px] text-muted">
          {mirror.lat.toFixed(5)}, {mirror.lon.toFixed(5)}
        </div>
        {pre.openingHours && <div className="text-[13px] text-muted">{pre.openingHours}</div>}
        <p className="text-[12px] leading-snug text-muted pt-2">{t("sourceNote")}</p>
        <Link href={mapHref} className="text-accent text-[13px] font-medium inline-block">
          {t("showOnMap")} →
        </Link>
      </section>

      {blocked ? (
        <p className="text-muted">{t(`state.${blocked}`)}</p>
      ) : !userId ? (
        <div className="bg-card border border-hairline rounded-[20px] p-6 space-y-4">
          <p className="text-sm text-muted">{t("signInFirst")}</p>
          <div className="flex gap-3 flex-wrap">
            <Link
              href={`/${locale}/login?next=${encodeURIComponent(next)}`}
              className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium"
            >
              {t("signIn")}
            </Link>
            <Link
              href={`/${locale}/register?next=${encodeURIComponent(next)}`}
              className="px-4 py-2 rounded-md border border-hairline text-sm font-medium"
            >
              {t("register")}
            </Link>
          </div>
        </div>
      ) : companies.length === 0 ? (
        <div className="bg-card border border-hairline rounded-[20px] p-6 space-y-4">
          <p className="text-sm text-muted">{t("noCompany")}</p>
          <Link
            href={`/${locale}/cabinet#companies`}
            className="inline-block px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium"
          >
            {t("createCompany")}
          </Link>
        </div>
      ) : (
        <div className="bg-card border border-hairline rounded-[20px] p-6">
          <ClaimPointForm
            osmKey={osmKey}
            companies={companies.map((m) => ({ id: m.company.id, name: m.company.displayName }))}
            locale={locale}
          />
        </div>
      )}
    </main>
  );
}
