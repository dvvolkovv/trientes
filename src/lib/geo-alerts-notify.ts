// Fan-out helper for GeoAlert. Called from admin approval / curation actions
// when a fintech or company point lands or moves to APPROVED status.

import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";

type FintechSummary = {
  id: string;
  slug: string;
  displayName: string;
  availableIn: string[];
};

type PointSummary = {
  id: string;
  name: string;
  countryCode: string | null;
  companyId: string;
};

const SITE_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

export async function notifyGeoForFintech(fintech: FintechSummary): Promise<{ sent: number }> {
  if (fintech.availableIn.length === 0) return { sent: 0 };
  const codes = fintech.availableIn.map((c) => c.toUpperCase());
  const alerts = await prisma.geoAlert.findMany({
    where: { enabled: true, notifyFintech: true, countryCode: { in: codes } },
    select: { userId: true, countryCode: true },
  });
  // Dedupe users — if a user subscribed to two countries the fintech covers,
  // send only one message.
  const seen = new Set<string>();
  let sent = 0;
  for (const a of alerts) {
    if (seen.has(a.userId)) continue;
    seen.add(a.userId);
    const text =
      `🌍 ${fintech.displayName} is now available in ${a.countryCode}\n` +
      `${SITE_ORIGIN}/en/fintech/${fintech.slug}`;
    await notifyUser({
      userId: a.userId,
      text,
      subject: `New fintech in ${a.countryCode}: ${fintech.displayName}`,
    });
    sent++;
  }
  return { sent };
}

export async function notifyGeoForPoint(point: PointSummary): Promise<{ sent: number }> {
  if (!point.countryCode) return { sent: 0 };
  const cc = point.countryCode.toUpperCase();
  const alerts = await prisma.geoAlert.findMany({
    where: { enabled: true, notifyPoints: true, countryCode: cc },
    select: { userId: true },
  });
  let sent = 0;
  for (const a of alerts) {
    const text =
      `📍 New crypto-friendly place in ${cc}: ${point.name}\n` +
      `${SITE_ORIGIN}/en/navigator`;
    await notifyUser({
      userId: a.userId,
      text,
      subject: `New place in ${cc}: ${point.name}`,
    });
    sent++;
  }
  return { sent };
}
