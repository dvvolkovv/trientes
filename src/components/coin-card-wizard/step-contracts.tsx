"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { saveCoinCardSection } from "@/app/actions/coin-card";
import { SUPPORTED_CHAINS } from "@/lib/coin-card-validate";
import { Field, inputCls, labelCls, btnCls } from "./field";
import { LogoUpload } from "./logo-upload";

type Row = {
  chain: string;
  address: string;
  decimals: string;
  standard: string;
  explorerUrl: string;
  isCanonical: boolean;
};

const EMPTY_ROW: Row = {
  chain: "ethereum", address: "", decimals: "", standard: "",
  explorerUrl: "", isCanonical: true,
};

export function StepContracts({
  cardId,
  onSaved,
}: {
  cardId: string;
  onSaved: (completeness: number, missing: string[]) => void;
}) {
  const t = useTranslations("coinCard.wizard");
  const [native, setNative] = useState(false);
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY_ROW }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const patch = (i: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const contracts = native
            ? []
            : rows
                .filter((r) => r.address.trim())
                .map((r) => ({
                  chain: r.chain,
                  address: r.address.trim(),
                  decimals: r.decimals.trim() === "" ? null : Number(r.decimals),
                  standard: r.standard.trim() || null,
                  explorerUrl: r.explorerUrl.trim() || null,
                  isCanonical: r.isCanonical,
                }));
          const res = await saveCoinCardSection({
            cardId, section: "CONTRACTS", payload: { contracts },
          });
          if (res.ok) onSaved(res.completeness, res.missing);
          else setError(res.reason);
        });
      }}
    >
      <LogoUpload cardId={cardId} onUploaded={() => undefined} />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={native} onChange={(e) => setNative(e.target.checked)} />
        {t("nativeCoin")}
      </label>

      {!native &&
        rows.map((r, i) => (
          <div key={i} className="border border-hairline rounded-md p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className={`${labelCls} mb-0`}>
                {t("contract")} {i + 1}
              </span>
              {rows.length > 1 && (
                <button type="button" className="text-down text-xs"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  {t("remove")}
                </button>
              )}
            </div>
            <Field id={`cc-chain-${i}`} label={t("chain")}>
              <select id={`cc-chain-${i}`} value={r.chain} className={inputCls}
                onChange={(e) => patch(i, { chain: e.target.value })}>
                {SUPPORTED_CHAINS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field id={`cc-addr-${i}`} label={t("address")} hint={t("addressHint")}>
              <input id={`cc-addr-${i}`} value={r.address} className={`${inputCls} font-mono`}
                onChange={(e) => patch(i, { address: e.target.value })} />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field id={`cc-dec-${i}`} label={t("decimals")}>
                <input id={`cc-dec-${i}`} value={r.decimals} inputMode="numeric" className={inputCls}
                  onChange={(e) => patch(i, { decimals: e.target.value })} />
              </Field>
              <Field id={`cc-std-${i}`} label={t("standard")}>
                <input id={`cc-std-${i}`} value={r.standard} placeholder="ERC-20" className={inputCls}
                  onChange={(e) => patch(i, { standard: e.target.value })} />
              </Field>
            </div>
            <Field id={`cc-exp-${i}`} label={t("explorerUrl")}>
              <input id={`cc-exp-${i}`} value={r.explorerUrl} className={inputCls}
                onChange={(e) => patch(i, { explorerUrl: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={r.isCanonical}
                onChange={(e) => patch(i, { isCanonical: e.target.checked })} />
              {t("isCanonical")}
            </label>
          </div>
        ))}

      {!native && rows.length < 20 && (
        <button type="button" className="text-accent text-sm"
          onClick={() => setRows((rs) => [...rs, { ...EMPTY_ROW, isCanonical: false }])}>
          + {t("addChain")}
        </button>
      )}

      {error && <p className="text-down text-sm">{t(`errors.${error}`)}</p>}
      <button type="submit" disabled={pending} className={btnCls}>
        {pending ? t("saving") : t("next")}
      </button>
    </form>
  );
}
