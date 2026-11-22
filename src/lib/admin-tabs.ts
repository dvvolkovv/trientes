import type { QueueKey } from "@/lib/cases/queues";

/**
 * Закладки полосы админки. Живут отдельно от компонента, чтобы их мог прочитать
 * тест границы (компонент тянет Prisma) и страница «Вид разделов».
 *
 * Закладка рисуется, только если она доступна: сотруднику без прав на каталог
 * монет незачем видеть «Coins». Прямой переход всё равно проверяется на
 * сервере — скрытая ссылка не защита.
 */
export type AdminTab = { key: string; path: string; queues?: QueueKey[]; owner?: boolean };

export const ADMIN_TABS: AdminTab[] = [
  { key: "queues", path: "queues" },
  { key: "staff", path: "staff", owner: true },
  { key: "requests", path: "requests", queues: ["coinRequests"] },
  { key: "coinCards", path: "coin-cards", queues: ["coinCards"] },
  { key: "business", path: "business", queues: ["companies", "points", "kyb"] },
  { key: "fintech", path: "fintech", queues: ["fintech"] },
  { key: "exchanges", path: "exchanges", queues: ["exchanges"] },
  { key: "coins", path: "coins", owner: true },
  { key: "users", path: "users", owner: true },
  { key: "audit", path: "audit", owner: true },
  { key: "analytics", path: "analytics", owner: true },
];
