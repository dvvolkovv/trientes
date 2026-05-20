import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type ReqRow = {
  id: string;
  name: string;
  symbol: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectReason: string | null;
  createdAt: Date;
};

function badgeCls(status: ReqRow["status"]): string {
  const base =
    "num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium";
  switch (status) {
    case "PENDING":
      return `${base} bg-accent/20 text-accent`;
    case "APPROVED":
      return `${base} bg-up/15 text-up`;
    case "REJECTED":
      return `${base} bg-down/15 text-down`;
  }
}

export async function CoinRequestList() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return null;

  const rows = (await prisma.coinRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      symbol: true,
      reason: true,
      status: true,
      rejectReason: true,
      createdAt: true,
    },
  })) as ReqRow[];

  const t = await getTranslations("request");
  if (rows.length === 0) {
    return <p className="text-muted text-sm">{t("noRequestsYet")}</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div
          key={r.id}
          className="bg-card border border-hairline rounded-[20px] p-5 md:p-6 space-y-3"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-[15px]">{r.name}</span>
            <span className="num text-[11px] uppercase tracking-wider text-muted">
              {r.symbol}
            </span>
            <span className={`ml-auto ${badgeCls(r.status)}`}>
              {t(`status.${r.status}`)}
            </span>
          </div>
          <p className="text-sm text-muted">{r.reason}</p>
          {r.status === "REJECTED" && r.rejectReason && (
            <p className="text-down text-sm">
              {t("rejectReasonLabel")}: {r.rejectReason}
            </p>
          )}
          <p className="num text-[11px] text-muted">
            {r.createdAt.toISOString().slice(0, 10)}
          </p>
        </div>
      ))}
    </div>
  );
}
