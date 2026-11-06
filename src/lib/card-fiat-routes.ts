// Путь к фиату (слайс F3): через кого монету можно принять и вывести в деньги.
// Связь — FintechCompany.supportedCardIds, созданный миграцией слайса F.
// Новых полей каталогу не требуется: страны, фиаты, уровень KYC и сводка
// комиссий у него уже есть.

import { prisma } from "@/lib/prisma";

/** Сколько сервисов показываем в карточке, прежде чем уводить в каталог. */
export const FIAT_ROUTE_LIMIT = 6;

export type FiatRouteRow = {
  id: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  services: string[];
  availableIn: string[];
  supportedFiats: string[];
  kycLevel: string | null;
  feesSummary: string | null;
};

/**
 * Для продавца важнее всего вывести выручку и принять платёж, поэтому сервисы
 * с этими услугами идут первыми, а стейкинг и кастоди — после.
 */
const SERVICE_WEIGHT: Record<string, number> = {
  OFFRAMP: 0,
  PAYMENTS: 0,
  ONRAMP: 1,
  EXCHANGE: 1,
  IBAN: 2,
  SEPA: 2,
  SWIFT: 2,
  CARD: 3,
};
const DEFAULT_WEIGHT = 9;

function weight(services: readonly string[]): number {
  return services.reduce(
    (best, s) => Math.min(best, SERVICE_WEIGHT[s] ?? DEFAULT_WEIGHT),
    DEFAULT_WEIGHT,
  );
}

export type FiatRoutes = {
  rows: FiatRouteRow[];
  hasMore: boolean;
  /** Сколько сервисов на каждую услугу — по всем строкам, не только показанным. */
  byService: { service: string; count: number }[];
  countries: string[];
  fiats: string[];
};

/** Чистая часть: порядок, потолок и сводка. */
export function rankFiatRoutes(rows: readonly FiatRouteRow[]): FiatRoutes {
  const sorted = [...rows].sort(
    (a, b) => weight(a.services) - weight(b.services) || a.displayName.localeCompare(b.displayName),
  );
  const counts = new Map<string, number>();
  const countries = new Set<string>();
  const fiats = new Set<string>();
  for (const r of rows) {
    for (const s of r.services) counts.set(s, (counts.get(s) ?? 0) + 1);
    for (const c of r.availableIn) if (c) countries.add(c.toUpperCase());
    for (const f of r.supportedFiats) if (f) fiats.add(f.toUpperCase());
  }
  return {
    rows: sorted.slice(0, FIAT_ROUTE_LIMIT),
    hasMore: sorted.length > FIAT_ROUTE_LIMIT,
    byService: [...counts.entries()]
      .map(([service, count]) => ({ service, count }))
      .sort((a, b) => b.count - a.count || a.service.localeCompare(b.service)),
    countries: [...countries].sort(),
    fiats: [...fiats].sort(),
  };
}

/**
 * Только одобренные сервисы: непроверенный сервис — не путь к деньгам.
 * Без кеша, как и счётчик приёма: одобрение модератором должно быть видно сразу.
 */
export async function getFiatRoutes(cardId: string): Promise<FiatRoutes> {
  const rows = await prisma.fintechCompany.findMany({
    where: { status: "APPROVED", supportedCardIds: { has: cardId } },
    orderBy: { displayName: "asc" },
    take: 100,
    select: {
      id: true, slug: true, displayName: true, logoUrl: true, services: true,
      availableIn: true, supportedFiats: true, kycLevel: true, feesSummary: true,
    },
  });
  return rankFiatRoutes(
    rows.map((r) => ({
      ...r,
      services: r.services as string[],
      kycLevel: r.kycLevel ?? null,
    })),
  );
}

/** Одобренные собственные листинги для выбора в форме финтех-сервиса. */
export async function listSelectableCards() {
  return prisma.coinCard.findMany({
    // У CoinCard мягкого удаления нет — карточку отклоняют, а не удаляют.
    where: { status: "APPROVED" },
    orderBy: [{ trust: "desc" }, { name: "asc" }],
    take: 200,
    select: { id: true, name: true, symbol: true, logoUrl: true },
  });
}
