import { getTranslations } from "next-intl/server";

type Row = {
  id: string;
  createdAt: Date;
  action: string;
  targetType: string;
  targetId: string;
  details: unknown;
  actor: { email: string | null; name: string | null };
};

export async function AuditTable({ rows }: { rows: Row[] }) {
  const t = await getTranslations("admin.audit");
  if (rows.length === 0) {
    return (
      <div className="bg-card border border-hairline rounded-[20px] p-8 text-center text-muted">
        {t("empty")}
      </div>
    );
  }
  return (
    <div className="bg-card border border-hairline rounded-[20px] overflow-hidden mt-8">
      <table className="w-full">
        <thead>
          <tr className="border-b border-hairline">
            <th className="text-left text-[11px] uppercase tracking-[0.18em] text-muted font-medium px-5 py-4">
              {t("when")}
            </th>
            <th className="text-left text-[11px] uppercase tracking-[0.18em] text-muted font-medium px-5 py-4">
              {t("who")}
            </th>
            <th className="text-left text-[11px] uppercase tracking-[0.18em] text-muted font-medium px-5 py-4">
              {t("action")}
            </th>
            <th className="text-left text-[11px] uppercase tracking-[0.18em] text-muted font-medium px-5 py-4">
              {t("target")}
            </th>
            <th className="text-left text-[11px] uppercase tracking-[0.18em] text-muted font-medium px-5 py-4">
              {t("details")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr
              key={r.id}
              className={idx < rows.length - 1 ? "border-b border-hairline" : ""}
            >
              <td className="px-5 py-4 num text-[11px] text-muted">
                {r.createdAt.toISOString().replace("T", " ").slice(0, 16)}
              </td>
              <td className="px-5 py-4 text-sm">
                {r.actor.email ?? r.actor.name ?? "(unknown)"}
              </td>
              <td className="px-5 py-4">
                <span className="bg-card-alt text-foreground num text-[10px] uppercase tracking-[0.15em] px-2 py-1 rounded-sm">
                  {r.action}
                </span>
              </td>
              <td className="px-5 py-4 num text-[11px] text-muted-strong">
                {r.targetType}:{r.targetId}
              </td>
              <td className="px-5 py-4 num text-[11px] text-muted font-mono">
                {r.details ? JSON.stringify(r.details) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
