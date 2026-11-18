import { prisma } from "@/lib/prisma";
import type { CaseSubjectType } from "@prisma/client";
import { independentReporters } from "@/lib/points/report-rules";

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
