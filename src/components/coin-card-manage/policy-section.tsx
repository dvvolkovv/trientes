"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CoinCardSection } from "@prisma/client";
import { EDITABLE_SECTIONS } from "@/lib/coin-card-form-spec";
import { updateCardPolicy } from "@/app/actions/coin-card-policy";

export function PolicySection({
  cardId,
  multisig,
  threshold,
  sections,
  signerCount,
  canManage,
}: {
  cardId: string;
  multisig: boolean;
  threshold: number;
  sections: CoinCardSection[];
  signerCount: number;
  canManage: boolean;
}) {
  const t = useTranslations("coinCard.policy");
  const tr = useTranslations("coinCard.team");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(multisig);
  const [m, setM] = useState(threshold);
  const [secs, setSecs] = useState<CoinCardSection[]>(sections);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  return (
    <section id="policy">
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h2>
      <p className="text-sm text-muted mb-4">{t("subtitle", { signers: signerCount })}</p>

      <div className="border border-hairline rounded-md p-4 space-y-4 bg-card-alt">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={on}
            disabled={!canManage || pending}
            onChange={(e) => setOn(e.target.checked)}
          />
          {t("enable")}
        </label>

        {on ? (
          <>
            <label className="block max-w-[200px]">
              <span className="num text-[10px] uppercase tracking-[0.14em] text-muted">
                {t("threshold")}
              </span>
              <input
                type="number"
                min={1}
                max={Math.max(1, signerCount)}
                value={m}
                disabled={!canManage || pending}
                onChange={(e) => setM(Number(e.target.value))}
                className="w-full mt-1 px-3 py-2 rounded-md border border-hairline bg-bg-tint text-sm"
              />
              <span className="text-xs text-muted">
                {t("thresholdHint", { m, n: signerCount })}
              </span>
            </label>

            <div>
              <span className="num text-[10px] uppercase tracking-[0.14em] text-muted">
                {t("sections")}
              </span>
              <p className="text-xs text-muted mb-2">{t("sectionsHint")}</p>
              <div className="flex flex-wrap gap-2">
                {EDITABLE_SECTIONS.map((s) => (
                  <label key={s} className="text-[11px] flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={secs.includes(s as CoinCardSection)}
                      disabled={!canManage || pending}
                      onChange={(e) =>
                        setSecs((cur) =>
                          e.target.checked
                            ? [...cur, s as CoinCardSection]
                            : cur.filter((x) => x !== s),
                        )
                      }
                    />
                    {tr(`section.${s}`)}
                  </label>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {canManage ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              setNote(null);
              start(async () => {
                const r = await updateCardPolicy({
                  cardId,
                  multisig: on,
                  threshold: m,
                  sections: secs,
                });
                if (r.ok) {
                  setNote(r.via);
                  router.refresh();
                } else {
                  setError(r.reason);
                }
              });
            }}
            className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
          >
            {pending ? t("saving") : t("save")}
          </button>
        ) : null}

        {error ? <p className="text-red-500 text-xs">{t(`errors.${error}`)}</p> : null}
        {note ? <p className="text-green-500 text-xs">{t(`applied.${note}`)}</p> : null}
      </div>
    </section>
  );
}
