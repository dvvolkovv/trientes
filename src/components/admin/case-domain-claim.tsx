"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ADMIN_BUTTON } from "@/lib/admin-ui";
import { askEngineering, replyToClaim, setClaimTarget } from "@/app/actions/domain-claims";

/**
 * Раздел «Письмо с домена» в деле (слайс CI).
 *
 * Проверяющий должен увидеть три вещи и ровно в этом порядке: чем доказан
 * домен, что именно написали, и каким нашим объектам это доказательство
 * относится. Решение принимается ниже, в общем разделе «Решение» — две двери к
 * одному решению означают, что правила четырёх глаз нет (правило AP).
 */

export type ClaimEmailView = {
  id: string;
  side: "PROJECT" | "STAFF";
  subject: string | null;
  bodyText: string | null;
  fromAddress: string;
  receivedAt: string;
  authRaw: string | null;
};

export type ClaimTargetView = {
  id: string;
  kind: "COIN_CARD" | "FINTECH";
  name: string;
  domain: string;
  href: string;
  selected: boolean;
  owned: boolean;
};

export function CaseDomainClaim({
  claimId,
  domain,
  proofKind,
  matchKind,
  fromAddress,
  fromName,
  status,
  emails,
  targets,
  needsEngineering,
  canHandle,
  canDecide,
}: {
  claimId: string;
  domain: string;
  proofKind: "DKIM" | "DMARC_SPF";
  matchKind: "EXACT" | "PARENT" | "SUBDOMAIN";
  fromAddress: string;
  fromName: string | null;
  status: "NEW" | "APPROVED" | "REJECTED";
  emails: ClaimEmailView[];
  targets: ClaimTargetView[];
  needsEngineering: boolean;
  canHandle: boolean;
  canDecide: boolean;
}) {
  const t = useTranslations("admin.case.domainClaim");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [showProof, setShowProof] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; reason?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) {
        setError(t(`error.${res.reason}`));
        return;
      }
      after?.();
      router.refresh();
    });

  const proofRaw = emails.find((e) => e.authRaw !== null)?.authRaw ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-md border border-hairline bg-card-alt p-3">
        <div className="text-[12.5px] font-semibold">{t(`proof.${proofKind}`, { domain })}</div>
        <p className="mt-1 text-[11.5px] text-muted">{t(`match.${matchKind}`)}</p>
        <p className="mt-1 text-[11.5px] text-muted">
          {t("sender")}: <span className="font-mono">{fromAddress}</span>
          {fromName ? ` · ${fromName}` : ""}
        </p>
        {proofRaw && (
          <>
            <button
              type="button"
              onClick={() => setShowProof((v) => !v)}
              className="mt-2 text-[11.5px] underline"
            >
              {showProof ? t("hideProof") : t("showProof")}
            </button>
            {showProof && (
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-card p-2 text-[10.5px] leading-relaxed text-muted">
                {proofRaw}
              </pre>
            )}
          </>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-[13px] font-semibold">{t("targets")}</h3>
        <p className="mb-2 text-[11.5px] text-muted">{t("targetsHint")}</p>
        <ul className="flex flex-col gap-2">
          {targets.map((target) => (
            <li
              key={target.id}
              className="flex items-start gap-3 rounded-md border border-hairline p-3"
            >
              <input
                type="checkbox"
                checked={target.selected}
                disabled={!canDecide || target.owned || status !== "NEW" || pending}
                onChange={(e) => run(() => setClaimTarget(target.id, e.target.checked))}
                className="mt-0.5 h-5 w-5"
                aria-label={target.name}
              />
              <div className="min-w-0 flex-1">
                <a href={target.href} className="text-[12.5px] font-semibold underline">
                  {target.name}
                </a>
                <div className="text-[11px] text-muted">
                  {t(`kind.${target.kind}`)} · {target.domain}
                </div>
                {target.owned && <div className="mt-1 text-[11px] text-amber-500">{t("owned")}</div>}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 text-[13px] font-semibold">{t("letters")}</h3>
        <ul className="flex flex-col">
          {emails.map((mail) => (
            <li key={mail.id} className="border-b border-hairline py-2.5 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] font-semibold">
                  {mail.side === "PROJECT" ? t("sideProject") : t("sideStaff")}
                </span>
                <span className="num text-[10.5px] text-muted">{mail.receivedAt.slice(0, 16)}</span>
              </div>
              {mail.subject && <div className="text-[11.5px] text-muted">{mail.subject}</div>}
              {mail.bodyText && (
                <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed">
                  {mail.bodyText}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      {canHandle && status === "NEW" && (
        <div className="flex flex-col gap-2">
          <label className="text-[12px] font-semibold" htmlFor="claim-reply">
            {t("replyTitle")}
          </label>
          <textarea
            id="claim-reply"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder={t("replyPlaceholder")}
            className="w-full rounded-md border border-hairline bg-card p-2 text-[13px]"
          />
          <button
            type="button"
            disabled={pending || reply.trim().length < 3}
            onClick={() => run(() => replyToClaim(claimId, reply), () => setReply(""))}
            className={ADMIN_BUTTON}
          >
            {t("reply")}
          </button>
        </div>
      )}

      {canHandle && (
        <div className="flex flex-col gap-2 rounded-md border border-hairline p-3">
          <div className="text-[12px] font-semibold">{t("engineeringTitle")}</div>
          <p className="text-[11.5px] text-muted">{t("engineeringHint")}</p>
          {needsEngineering ? (
            <p className="text-[12px] text-green-500">{t("engineeringAsked")}</p>
          ) : (
            <>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={t("engineeringPlaceholder")}
                className="w-full rounded-md border border-hairline bg-card p-2 text-[13px]"
              />
              <button
                type="button"
                disabled={pending || note.trim().length < 3}
                onClick={() => run(() => askEngineering(claimId, note), () => setNote(""))}
                className={ADMIN_BUTTON}
              >
                {t("engineering")}
              </button>
            </>
          )}
        </div>
      )}

      {error && <p className="text-[12px] text-red-400">{error}</p>}
    </div>
  );
}
