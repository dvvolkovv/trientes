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
    return <p className="text-muted-foreground">{t("empty")}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 text-left font-medium">{t("when")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("who")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("action")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("target")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("details")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                {r.createdAt.toISOString().replace("T", " ").slice(0, 16)}
              </td>
              <td className="px-3 py-2">{r.actor.email ?? r.actor.name ?? "(unknown)"}</td>
              <td className="px-3 py-2">
                <span className="px-2 py-0.5 text-xs rounded bg-muted">{r.action}</span>
              </td>
              <td className="px-3 py-2 text-xs">
                {r.targetType}:{r.targetId}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground font-mono">
                {r.details ? JSON.stringify(r.details) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
