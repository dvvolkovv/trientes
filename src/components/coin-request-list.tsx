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
  switch (status) {
    case "PENDING":
      return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
    case "APPROVED":
      return "bg-green-500/15 text-green-700 dark:text-green-400";
    case "REJECTED":
      return "bg-red-500/15 text-red-700 dark:text-red-400";
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
    return <p className="text-muted-foreground text-sm">{t("noRequestsYet")}</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.id} className="border rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-medium">{r.name}</span>
            <span className="text-xs text-muted-foreground uppercase">{r.symbol}</span>
            <span className={`ml-auto px-2 py-0.5 text-xs rounded ${badgeCls(r.status)}`}>
              {t(`status.${r.status}`)}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{r.reason}</p>
          {r.status === "REJECTED" && r.rejectReason && (
            <p className="text-sm text-red-500">
              {t("rejectReasonLabel")}: {r.rejectReason}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{r.createdAt.toISOString().slice(0, 10)}</p>
        </div>
      ))}
    </div>
  );
}
