/**
 * Страница рекламного материала (слайс BZ).
 *
 * Нажатие на баннер ведёт сюда — на отдельный адрес, который можно переслать. Карточка
 * предприятия собирается одной функцией (`buildCompanyCard`, правило BY), и страница
 * материала берёт её же: две сборки одной витрины уже расходились (живой прогон BX).
 *
 * Видимость — те же правила, что у баннера (`adVisible`): залистованное и не снятое
 * надзором предприятие, материал опубликован и идёт сейчас. Иначе страницы нет.
 */

import { prisma } from "@/lib/prisma";
import { NOT_DELETED } from "@/lib/soft-delete";
import { adVisible } from "@/lib/ads/rules";
import { canWrite, editorCompany } from "@/lib/products/editor-company";
import { can } from "@/lib/company-team/permissions";
import { buildCompanyCard, type CardAd, type CompanyCardView } from "@/lib/company-card/view";

export type AdPageView = {
  ad: CardAd;
  card: CompanyCardView;
  /** Соседние материалы того же предприятия — чтобы со страницы было куда идти. */
  siblings: { id: string; title: string; preview: string; href: string }[];
  /**
   * Предпросмотр (слайс CB): материал снаружи ещё не виден, а эту страницу открыл
   * тот, кто вправе его вести. Показываем всё как покупателю — но с плашкой, чтобы
   * черновик не приняли за опубликованное.
   */
  preview: boolean;
  /** Можно ли опубликовать прямо отсюда: право `promos` на правку. */
  canPublish: boolean;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
};

export async function readAdPage(input: {
  adId: string;
  locale: string;
  now?: Date;
  original?: boolean;
  /** Кто смотрит. Нужен ради предпросмотра черновика — больше ни для чего. */
  viewerId?: string | null;
}): Promise<AdPageView | null> {
  const now = input.now ?? new Date();

  const row = await prisma.companyAd.findFirst({
    where: { id: input.adId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      companyId: true,
      company: { select: { status: true, suspendedAt: true, deletedAt: true } },
    },
  });
  if (!row) return null;

  // Снаружи — те же правила, что у баннера. Изнутри предприятия черновик показываем
  // тому, кто вправе его вести: предпросмотр до публикации и есть смысл слайса CB.
  const visible = adVisible({ company: row.company, ad: row }, now);
  let preview = false;
  let canPublish = false;
  if (!visible) {
    if (!input.viewerId) return null;
    const gate = await editorCompany(row.companyId, input.viewerId);
    if (!gate || !can(gate.permissions, "promos", "VIEW")) return null;
    preview = true;
    canPublish = canWrite(gate, "promos");
  }

  const card = await buildCompanyCard({
    companyId: row.companyId,
    locale: input.locale,
    now,
    original: input.original,
    previewAdId: preview ? row.id : null,
  });
  if (!card) return null;

  // Материал ищем в уже собранной карточке: там он уже прошёл и окно показа, и
  // гашение действия по снятому товару или снятой точке.
  const ad = card.ads.find((a) => a.id === input.adId);
  if (!ad) return null;

  return {
    ad,
    card,
    preview,
    canPublish,
    status: row.status as "DRAFT" | "PUBLISHED" | "ARCHIVED",
    siblings: card.ads
      .filter((a) => a.id !== ad.id)
      .map((a) => ({
        id: a.id,
        title: a.title,
        preview: a.mediaKind === "VIDEO" ? (a.posterUrl ?? a.mediaUrl) : a.mediaUrl,
        href: a.href,
      })),
  };
}

/** Заголовок и описание страницы: их читает и поисковик, и пересланная ссылка. */
export async function readAdMeta(adId: string): Promise<{ title: string; body: string | null; company: string; image: string } | null> {
  const row = await prisma.companyAd.findFirst({
    where: { id: adId, status: "PUBLISHED", company: { ...NOT_DELETED } },
    select: {
      title: true, body: true, mediaUrl: true, posterUrl: true, mediaKind: true,
      company: { select: { displayName: true, status: true, suspendedAt: true } },
    },
  });
  if (!row || row.company.status !== "APPROVED" || row.company.suspendedAt) return null;
  return {
    title: row.title,
    body: row.body,
    company: row.company.displayName,
    image: row.mediaKind === "VIDEO" ? (row.posterUrl ?? row.mediaUrl) : row.mediaUrl,
  };
}
