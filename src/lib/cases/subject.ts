import { prisma } from "@/lib/prisma";
import type { CaseSubjectType } from "@prisma/client";
import { independentReporters } from "@/lib/points/report-rules";
import { parseChanges } from "@/lib/company-edit";
import { adDiff, readPendingPayload } from "@/lib/ads/moderation";

export type SubjectField = { label: string; value: string };
export type SubjectSummary = {
  title: string;
  applicantUserId: string | null;
  /** Куда смотреть сам объект на публичной стороне, если он там есть. */
  href: string | null;
  fields: SubjectField[];
};

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function text(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

export async function loadSubject(
  subjectType: CaseSubjectType,
  subjectId: string,
): Promise<SubjectSummary | null> {
  switch (subjectType) {
    case "COMPANY":
    case "KYB": {
      const c = await prisma.company.findUnique({ where: { id: subjectId } });
      if (!c) return null;
      return {
        title: c.displayName,
        applicantUserId: c.ownerUserId,
        href: `/en/companies/${c.id}`,
        fields: [
          { label: "legalName", value: text(c.legalName) },
          { label: "country", value: text(c.country) },
          { label: "city", value: text(c.city) },
          {
            label: "address",
            value: text(c.address ?? `${c.street ?? ""} ${c.houseNumber ?? ""}`.trim()),
          },
          { label: "email", value: text(c.email) },
          { label: "phone", value: text(c.phone) },
          { label: "website", value: text(c.website) },
        ],
      };
    }
    case "POINT": {
      const p = await prisma.companyPoint.findUnique({
        where: { id: subjectId },
        include: { company: { select: { displayName: true, ownerUserId: true } } },
      });
      if (!p) return null;
      return {
        title: p.name,
        applicantUserId: p.company?.ownerUserId ?? null,
        href: null,
        fields: [
          { label: "company", value: text(p.company?.displayName) },
          { label: "type", value: p.type },
          { label: "country", value: text(p.countryCode) },
          { label: "address", value: text(p.address) },
          {
            label: "coords",
            value: p.lat !== null && p.lon !== null ? `${p.lat}, ${p.lon}` : "—",
          },
          // Заявка на чужую точку зеркала BTC Map — это другой разговор, чем
          // новая точка: проверяющий должен видеть, что место на карте уже
          // есть и предприятие забирает именно его.
          ...(p.osmId
            ? [
                { label: "claims BTC Map point", value: p.osmId },
                {
                  label: "openstreetmap",
                  value: `https://www.openstreetmap.org/${p.osmId.replace(":", "/")}`,
                },
              ]
            : []),
        ],
      };
    }
    case "COIN_CARD": {
      const card = await prisma.coinCard.findUnique({ where: { id: subjectId } });
      if (!card) return null;
      return {
        title: `${card.name} (${card.symbol})`,
        applicantUserId: card.stewardUserId,
        href: `/en/cards/${card.slug}`,
        fields: [
          { label: "symbol", value: card.symbol },
          { label: "completeness", value: `${card.completeness}%` },
          { label: "trust", value: card.trust },
          { label: "tagline", value: text(card.tagline) },
        ],
      };
    }
    case "EXCHANGE": {
      const e = await prisma.registeredExchange.findUnique({ where: { id: subjectId } });
      if (!e) return null;
      return {
        title: e.displayName,
        applicantUserId: e.ownerUserId,
        href: null,
        fields: [{ label: "legalName", value: text(e.legalName) }],
      };
    }
    case "FINTECH": {
      const f = await prisma.fintechCompany.findUnique({ where: { id: subjectId } });
      if (!f) return null;
      return {
        title: f.displayName,
        applicantUserId: f.ownerUserId ?? null,
        href: null,
        fields: [{ label: "legalName", value: text(f.legalName) }],
      };
    }
    case "COIN_REQUEST": {
      const r = await prisma.coinRequest.findUnique({ where: { id: subjectId } });
      if (!r) return null;
      return {
        title: `${r.name} (${r.symbol})`,
        applicantUserId: r.userId,
        href: null,
        fields: [
          { label: "symbol", value: r.symbol },
          { label: "coingeckoId", value: text(r.coingeckoId) },
          { label: "reason", value: r.reason },
        ],
      };
    }
    case "COMPANY_AD": {
      const ad = await prisma.companyAd.findUnique({
        where: { id: subjectId },
        include: {
          company: {
            select: {
              id: true, displayName: true, legalName: true, ownerUserId: true,
              kybStatus: true, registrationNumber: true, country: true, suspendedAt: true,
            },
          },
          _count: { select: { documents: true } },
        },
      });
      if (!ad) return null;
      const pending = readPendingPayload(ad.pendingPayload);
      return {
        title: ad.title,
        // Разговор ведётся с владельцем предприятия: материал мог завести
        // маркетолог, но отвечает за сказанное владелец.
        applicantUserId: ad.company.ownerUserId,
        href: `/en/ad/${ad.id}`,
        fields: [
          { label: "company", value: ad.company.displayName },
          // «Мы понимаем, кто за этим стоит» — просьба владельца дословно: лицо,
          // номер регистрации и состояние проверки стоят там, где принимается
          // решение, а не на другом экране.
          { label: "legalName", value: text(ad.company.legalName) },
          { label: "registrationNumber", value: text(ad.company.registrationNumber) },
          { label: "country", value: text(ad.company.country) },
          { label: "kyb", value: text(ad.company.kybStatus) },
          { label: "suspended", value: ad.company.suspendedAt ? day(ad.company.suspendedAt) : "—" },
          { label: "adKind", value: ad.kind },
          { label: "language", value: ad.language },
          { label: "mediaKind", value: ad.mediaKind },
          { label: "voice", value: ad.audioUrl ? (ad.audioGenerated ? "trientes" : "own") : "—" },
          { label: "promoCode", value: text(ad.promoCode) },
          {
            label: "window",
            value: ad.startsAt || ad.endsAt
              ? `${ad.startsAt ? day(ad.startsAt) : "…"} — ${ad.endsAt ? day(ad.endsAt) : "…"}`
              : "—",
          },
          { label: "event", value: ad.eventAt ? `${day(ad.eventAt)}${ad.eventEndAt ? ` — ${day(ad.eventEndAt)}` : ""}` : "—" },
          { label: "place", value: text([ad.placeName, ad.placeAddress].filter(Boolean).join(", ") || null) },
          { label: "action", value: ad.action },
          { label: "documents", value: String(ad._count.documents) },
          // Правка ждущего слепка — это другой разговор, чем первая публикация, и
          // проверяющий должен видеть разницу сразу, а не искать её глазами.
          { label: "pendingChanges", value: pending ? String(adDiff(ad, pending as unknown as Record<string, unknown>).length) : "—" },
        ],
      };
    }
    case "COMPANY_REVISION": {
      const rev = await prisma.companyRevision.findUnique({
        where: { id: subjectId },
        include: { company: { select: { id: true, displayName: true, ownerUserId: true, kybStatus: true } } },
      });
      if (!rev) return null;
      const changes = parseChanges(rev.changes);
      const docs = Array.isArray(rev.documents) ? rev.documents : [];
      return {
        title: rev.company.displayName,
        // Разговор по правке ведётся с владельцем предприятия: автором может быть
        // сотрудник, но отвечать за карточку перед нами владелец.
        applicantUserId: rev.company.ownerUserId,
        href: `/en/companies/${rev.company.id}`,
        fields: [
          { label: "company", value: rev.company.displayName },
          { label: "kyb", value: text(rev.company.kybStatus) },
          // Было → стало по каждому полю: проверяющий решает именно про изменение,
          // а не про предприятие целиком.
          ...changes.map((c) => ({ label: c.field, value: `${c.before ?? "—"} → ${c.after ?? "—"}` })),
          { label: "documents", value: String(docs.length) },
        ],
      };
    }
    case "PRODUCT_CLAIM": {
      const claim = await prisma.productClaim.findUnique({
        where: { id: subjectId },
        include: {
          company: { select: { displayName: true, ownerUserId: true, kybStatus: true } },
          product: { select: { name: true, slug: true, gtin: true, brand: true, ownerCompanyId: true } },
        },
      });
      if (!claim) return null;
      return {
        title: claim.product.name,
        applicantUserId: claim.userId,
        href: `/en/product/${claim.product.slug}`,
        fields: [
          { label: "company", value: text(claim.company?.displayName) },
          { label: "kyb", value: text(claim.company?.kybStatus) },
          { label: "brand", value: text(claim.product.brand) },
          { label: "gtin", value: text(claim.product.gtin) },
          // Паспорт, у которого хозяин уже есть, второй заявке не достаётся: решающий
          // должен видеть это до того, как нажмёт «одобрить».
          { label: "alreadyOwned", value: claim.product.ownerCompanyId ? "yes" : "no" },
          { label: "evidence", value: claim.evidence.slice(0, 500) },
        ],
      };
    }
    case "PRODUCT_REPORT": {
      const p = await prisma.product.findUnique({
        where: { id: subjectId },
        include: { ownerCompany: { select: { displayName: true, ownerUserId: true } } },
      });
      if (!p) return null;
      const reports = await prisma.productReport.findMany({
        where: { productId: p.id },
        select: { reason: true, reporterUserId: true, reporterIpHash: true, createdAt: true, comment: true },
        orderBy: { createdAt: "desc" },
      });
      const byReason = new Map<string, number>();
      for (const r of reports) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
      return {
        // Разговор по делу ведётся с хозяином паспорта, если он есть: с жалобщиком
        // переписки нет (то же решение, что у жалоб на точки).
        title: p.name,
        applicantUserId: p.ownerCompany?.ownerUserId ?? null,
        href: `/en/product/${p.slug}`,
        fields: [
          { label: "owner", value: text(p.ownerCompany?.displayName) },
          { label: "reports", value: String(reports.length) },
          { label: "independent", value: String(independentReporters(reports, new Date())) },
          {
            label: "reasons",
            value: [...byReason.entries()].map(([k, n]) => `${k}×${n}`).join(", ") || "—",
          },
          { label: "gtin", value: text(p.gtin) },
          { label: "lastComment", value: text(reports.find((r) => r.comment)?.comment) },
          { label: "suspended", value: p.suspendedAt ? day(p.suspendedAt) : "—" },
        ],
      };
    }
    case "POINT_REPORT": {
      const p = await prisma.companyPoint.findUnique({
        where: { id: subjectId },
        include: { company: { select: { displayName: true, ownerUserId: true } } },
      });
      if (!p) return null;
      const reports = await prisma.pointReport.findMany({
        where: { pointId: p.id },
        select: { reason: true, reporterUserId: true, reporterIpHash: true, createdAt: true },
      });
      const byReason = new Map<string, number>();
      for (const r of reports) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
      return {
        // Переписку по делу ведём с предприятием, а не с жалобщиком: с анонимом
        // диалога нет (так в спеке).
        title: p.name,
        applicantUserId: p.company?.ownerUserId ?? null,
        href: null,
        fields: [
          { label: "company", value: text(p.company?.displayName) },
          { label: "reports", value: String(reports.length) },
          { label: "independent", value: String(independentReporters(reports, new Date())) },
          {
            label: "reasons",
            value: [...byReason.entries()].map(([k, n]) => `${k}×${n}`).join(", ") || "—",
          },
          { label: "address", value: text(p.address) },
          { label: "underReview", value: p.underReviewAt ? day(p.underReviewAt) : "—" },
          { label: "suspended", value: p.suspendedAt ? day(p.suspendedAt) : "—" },
        ],
      };
    }
  }
}
