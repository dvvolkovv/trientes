"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { recheckCardContracts } from "@/app/actions/coin-card-onchain";

export type ContractStatus = {
  id: string;
  chain: string;
  address: string;
  checkedAt: string | null;
  checkError: string | null;
  mismatches: string[];
  verified: boolean;
};

/**
 * «Сверить сейчас» для проекта, который только что поправил адрес: воркер
 * ходит раз в сутки, и ждать до утра, чтобы увидеть результат, незачем.
 */
export function OnchainRecheck({
  cardId,
  contracts,
  canEdit,
}: {
  cardId: string;
  contracts: ContractStatus[];
  canEdit: boolean;
}) {
  const t = useTranslations("coinCard.onchain");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (contracts.length === 0) return null;

  return (
    <section id="onchain">
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h2>
      <p className="text-sm text-muted mb-4">{t("manageSubtitle")}</p>

      <div className="border border-hairline rounded-md p-4 space-y-3 bg-card-alt">
        <ul className="space-y-2">
          {contracts.map((c) => (
            <li key={c.id} className="text-sm">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted">{c.chain}</span>{" "}
              <span className="font-mono text-xs break-all">{c.address}</span>
              <div className="text-xs mt-0.5">
                {!c.checkedAt ? (
                  <span className="text-muted">{t("never")}</span>
                ) : c.checkError ? (
                  <span
                    className={
                      c.checkError === "not_a_contract" || c.checkError === "not_erc20"
                        ? "text-down"
                        : "text-muted"
                    }
                  >
                    {t(`error.${c.checkError}`)} · {c.checkedAt}
                  </span>
                ) : c.mismatches.length > 0 ? (
                  <span className="text-down">
                    {t("mismatchCount", { count: c.mismatches.length })} · {c.checkedAt}
                  </span>
                ) : (
                  <span className="text-up">
                    {t("matches")} · {c.checkedAt}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>

        {canEdit ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                setNote(null);
                const r = await recheckCardContracts(cardId);
                if (r.ok) {
                  setNote(
                    t("result", {
                      checked: r.stats.checked,
                      verified: r.stats.verified,
                      mismatched: r.stats.mismatched,
                      failed: r.stats.failed,
                    }),
                  );
                  router.refresh();
                } else {
                  setError(t(`reason.${r.reason}`));
                }
              })
            }
            className="text-sm px-3 py-1.5 rounded border border-hairline hover:border-accent disabled:opacity-50"
          >
            {pending ? t("rechecking") : t("recheck")}
          </button>
        ) : null}

        {note ? <p className="text-xs text-up">{note}</p> : null}
        {error ? <p className="text-xs text-down">{error}</p> : null}
      </div>
    </section>
  );
}
