import { prisma } from "@/lib/prisma";
import type { CaseSubjectType } from "@prisma/client";

export type SubjectField = { label: string; value: string };
export type SubjectSummary = {
  title: string;
  applicantUserId: string | null;
  /** Куда смотреть сам объект на публичной стороне, если он там есть. */
  href: string | null;
  fields: SubjectField[];
};

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
    case "POINT_REPORT":
      // Появится в слайсе AQ вместе с таблицей PointReport.
      return null;
  }
}
