/**
 * Четыре готовые должности. Это только заполнение матрицы — после нажатия
 * галочки правятся руками, иначе шаблон становится рамкой, из которой не выйти.
 */
import type { StaffLevel } from "@/lib/authz/policy";
import { QUEUES, type QueueKey } from "@/lib/cases/queues";

export type PresetKey = "readOnly" | "reviewer" | "senior" | "kybOfficer";

export const STAFF_PRESETS: { key: PresetKey }[] = [
  { key: "readOnly" },
  { key: "reviewer" },
  { key: "senior" },
  { key: "kybOfficer" },
];

export function presetGrants(key: PresetKey): Record<QueueKey, StaffLevel> {
  const all = (level: StaffLevel) =>
    Object.fromEntries(QUEUES.map((q) => [q.key, level])) as Record<QueueKey, StaffLevel>;

  switch (key) {
    case "readOnly":
      return all("VIEW");
    case "senior":
      return all("APPROVE");
    case "reviewer":
      return {
        ...all("VIEW"),
        coinCards: "HANDLE",
        coinRequests: "HANDLE",
        points: "HANDLE",
        pointReports: "HANDLE",
      };
    case "kybOfficer":
      return { ...all("VIEW"), kyb: "APPROVE", companies: "APPROVE" };
  }
}
