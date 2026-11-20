/**
 * Чтение интересов человека и двух его чисел. Правила — в `interests.ts`, здесь только
 * выборка. Гость получает умолчания, а не пустоту: навигатор нарочно работает без
 * входа, и остановки по пути он показывать обязан.
 */
import { prisma } from "@/lib/prisma";
import {
  ALERT_DEFAULT,
  CORRIDOR_DEFAULT,
  activeInterests,
  type InterestKey,
  type InterestMark,
} from "@/lib/interests";

export type ViewerRoutePrefs = {
  marks: InterestMark[];
  interests: InterestKey[];
  corridorMeters: number;
  alertMeters: number;
};

export const GUEST_ROUTE_PREFS: ViewerRoutePrefs = {
  marks: [],
  interests: activeInterests([]),
  corridorMeters: CORRIDOR_DEFAULT,
  alertMeters: ALERT_DEFAULT,
};

export async function readViewerRoutePrefs(userId: string | null): Promise<ViewerRoutePrefs> {
  if (!userId) return GUEST_ROUTE_PREFS;
  const [user, marks] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { routeCorridorMeters: true, routeAlertMeters: true },
    }),
    prisma.userInterest.findMany({ where: { userId }, select: { key: true, verdict: true } }),
  ]);
  if (!user) return GUEST_ROUTE_PREFS;
  return {
    marks,
    interests: activeInterests(marks),
    corridorMeters: user.routeCorridorMeters,
    alertMeters: user.routeAlertMeters,
  };
}
