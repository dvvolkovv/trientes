import type { KybStatus, Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { KybForm, type KybDoc } from "@/components/business/kyb-form";

type Doc = KybDoc;

export async function KybSection({
  companyId,
  status,
  documents,
  rejectionReason,
  canManage,
}: {
  companyId: string;
  status: KybStatus;
  documents: Prisma.JsonValue;
  rejectionReason: string | null;
  canManage: boolean;
}) {
  const t = await getTranslations("business.kyb");

  const docs: Doc[] = Array.isArray(documents) ? (documents as Doc[]) : [];

  return (
    <section>
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <h2 className="text-[24px] font-bold tracking-[-0.02em]">{t("title")}</h2>
        <span
          className={`text-xs px-2 py-0.5 rounded ${
            status === "APPROVED" ? "bg-green-500/15 text-green-500" :
            status === "REJECTED" ? "bg-red-500/15 text-red-500" :
            status === "PENDING"  ? "bg-yellow-500/15 text-yellow-500" :
            "bg-bg-tint text-muted"
          }`}
        >
          {t(`status.${status}`)}
        </span>
      </div>
      <p className="text-sm text-muted mb-4">{t("subtitle")}</p>

      {status === "REJECTED" && rejectionReason ? (
        <div className="mb-4 p-3 rounded-md border border-red-500/30 bg-red-500/10 text-sm text-red-300">
          {rejectionReason}
        </div>
      ) : null}

      {docs.length > 0 ? (
        <ul className="space-y-1 mb-4 text-sm">
          {docs.map((d, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider text-muted">{t(`kind.${d.kind}`)}</span>
              <a href={d.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline truncate">
                {d.label?.trim() || d.url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {canManage && status !== "APPROVED" ? (
        <KybForm companyId={companyId} initialDocs={docs} status={status} />
      ) : null}
    </section>
  );
}
