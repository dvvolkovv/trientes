"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cancelClaim, checkClaim, startClaim } from "@/app/actions/coin-card-claim";

export type ClaimView = {
  id: string;
  method: string;
  status: string;
  token: string;
  attempts: number;
  lastError: string | null;
  expiresAt: string;
  message: string;
};

const METHODS = ["OWNER_SIGNATURE", "DNS_TXT", "WELL_KNOWN"] as const;

/**
 * «Подтверждение владения» в кабинете карточки: вызов, инструкция под
 * выбранный способ и кнопка проверки. Доказательство предъявляет человек, мы
 * только проверяем — поэтому автоповтора здесь нет, есть кнопка.
 */
export function ClaimSection({
  cardId,
  claim,
  claimed,
  domain,
  canonicalAddress,
}: {
  cardId: string;
  claim: ClaimView | null;
  claimed: boolean;
  domain: string | null;
  canonicalAddress: string | null;
}) {
  const t = useTranslations("coinCard.claim");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [method, setMethod] = useState<string>("DNS_TXT");
  const [signature, setSignature] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; reason?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(t(`reason.${r.reason}`));
      router.refresh();
    });

  return (
    <section id="claim">
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h2>
      <p className="text-sm text-muted mb-4">{t("subtitle")}</p>

      <div className="border border-hairline rounded-md p-4 space-y-3 bg-card-alt">
        {claimed ? (
          <p className="text-sm text-up">{t("alreadyClaimed")}</p>
        ) : claim ? (
          <>
            <p className="text-sm">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted mr-2">
                {t(`method.${claim.method}`)}
              </span>
              <span className="text-muted text-xs">
                {t("attempts", { used: claim.attempts })} · {t("expires", { at: claim.expiresAt })}
              </span>
            </p>

            {claim.method === "DNS_TXT" && (
              <div className="text-sm space-y-1">
                <p>{t("instruction.DNS_TXT", { domain: domain ?? "—" })}</p>
                <code className="block text-xs font-mono break-all border border-hairline rounded px-2 py-1">
                  trientes-verification={claim.token}
                </code>
              </div>
            )}

            {claim.method === "WELL_KNOWN" && (
              <div className="text-sm space-y-1">
                <p>{t("instruction.WELL_KNOWN", { domain: domain ?? "—" })}</p>
                <code className="block text-xs font-mono break-all border border-hairline rounded px-2 py-1">
                  https://{domain ?? "example.com"}/.well-known/trientes-verification.txt
                </code>
                <code className="block text-xs font-mono break-all border border-hairline rounded px-2 py-1">
                  {claim.token}
                </code>
              </div>
            )}

            {claim.method === "OWNER_SIGNATURE" && (
              <div className="text-sm space-y-2">
                <p>{t("instruction.OWNER_SIGNATURE", { address: canonicalAddress ?? "—" })}</p>
                <pre className="text-xs font-mono whitespace-pre-wrap border border-hairline rounded px-2 py-1">
{claim.message}
                </pre>
                <input
                  type="text"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="0x…"
                  className="w-full text-xs font-mono bg-transparent border border-hairline rounded px-2 py-1"
                />
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => checkClaim(claim.id, signature || undefined))}
                className="text-sm px-3 py-1.5 rounded border border-hairline hover:border-accent disabled:opacity-50"
              >
                {pending ? t("checking") : t("check")}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => cancelClaim(claim.id))}
                className="text-sm px-3 py-1.5 rounded border border-hairline text-muted hover:border-down disabled:opacity-50"
              >
                {t("cancel")}
              </button>
            </div>

            {claim.lastError ? (
              <p className="text-xs text-down">{t(`reason.${claim.lastError}`)}</p>
            ) : null}
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`text-xs px-3 py-1.5 rounded border ${
                    method === m ? "border-accent text-accent" : "border-hairline text-muted"
                  }`}
                >
                  {t(`method.${m}`)}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">{t(`hint.${method}`)}</p>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => startClaim(cardId, method))}
              className="text-sm px-3 py-1.5 rounded border border-hairline hover:border-accent disabled:opacity-50"
            >
              {pending ? t("starting") : t("start")}
            </button>
          </>
        )}

        {error ? <p className="text-xs text-down">{error}</p> : null}
      </div>
    </section>
  );
}
