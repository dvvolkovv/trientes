import { describeEvent } from "@/lib/cases/journal";
import type { CaseEventKind } from "@prisma/client";

export type JournalEntry = {
  id: string;
  kind: CaseEventKind;
  payload: unknown;
  createdAt: Date;
  actorName: string | null;
};

export function CaseJournal({
  entries,
  locale,
  tr,
}: {
  entries: JournalEntry[];
  locale: string;
  tr: (key: string, params: Record<string, string | number>) => string;
}) {
  return (
    <div>
      {entries.map((e) => {
        const d = describeEvent({ kind: e.kind, payload: e.payload });
        return (
          <div key={e.id} className="flex gap-3 border-b border-hairline py-2.5 last:border-b-0">
            <div className="num w-[62px] shrink-0 text-[10px] text-muted">
              {new Intl.DateTimeFormat(locale, {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              }).format(e.createdAt)}
            </div>
            <div className="text-[11.5px] leading-snug">
              {e.actorName ? <b className="font-semibold">{e.actorName} </b> : null}
              {tr(`case.journal.${d.key}`, d.params)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
