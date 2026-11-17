import { attachmentUrl, type Attachment } from "@/lib/cases/attachments";

export type ThreadMessage = {
  id: string;
  side: "STAFF" | "APPLICANT";
  body: string;
  attachments: Attachment[];
  createdAt: Date;
  authorName: string | null;
};

/**
 * Одна нитка на дело: заявитель слева, мы справа. Один компонент на админку и
 * кабинет — расходиться этим двум видам нельзя, это один и тот же разговор.
 */
export function CaseThread({
  caseId,
  messages,
  locale,
  mySide,
  staffLabel,
  applicantLabel,
  emptyLabel,
}: {
  caseId: string;
  messages: ThreadMessage[];
  locale: string;
  mySide: "STAFF" | "APPLICANT";
  staffLabel: string;
  applicantLabel: string;
  emptyLabel: string;
}) {
  if (messages.length === 0) {
    return <p className="text-[12px] text-muted">{emptyLabel}</p>;
  }

  // Часы в языке страницы, а не браузера: тот же довод, что в ведении по маршруту.
  const time = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <ol className="flex flex-col gap-2.5">
      {messages.map((m) => {
        const mine = m.side === mySide;
        return (
          <li key={m.id} className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
            <div className="flex items-center gap-2 px-1 text-[10px] text-muted">
              <span className="font-semibold uppercase tracking-wider">
                {m.side === "STAFF" ? staffLabel : applicantLabel}
              </span>
              {m.authorName ? <span>{m.authorName}</span> : null}
              <span>{time.format(m.createdAt)}</span>
            </div>
            <div
              className={`max-w-[85%] rounded-[16px] px-3.5 py-2.5 text-[13px] leading-relaxed ${
                mine ? "border border-accent/30 bg-accent/10" : "border border-hairline bg-card-alt"
              }`}
            >
              {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
              {m.attachments.length > 0 ? (
                <ul className={m.body ? "mt-2 flex flex-col gap-1" : "flex flex-col gap-1"}>
                  {m.attachments.map((a) => (
                    <li key={a.name}>
                      <a
                        href={attachmentUrl(caseId, a.name)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent underline underline-offset-2"
                      >
                        📎 {a.filename}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
