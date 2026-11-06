"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ProgressBar } from "./progress-bar";
import { StepBasics } from "./step-basics";
import { StepContracts } from "./step-contracts";
import { StepTokenomics } from "./step-tokenomics";
import { StepTrust } from "./step-trust";

const STEPS = ["basics", "contracts", "tokenomics", "trust"] as const;

export function CoinCardWizard() {
  const t = useTranslations("coinCard.wizard");
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [cardId, setCardId] = useState<string | null>(null);
  const [website, setWebsite] = useState("");
  const [completeness, setCompleteness] = useState(0);
  const [missing, setMissing] = useState<string[]>([]);

  const advance = (next: number) => (c: number, m: string[]) => {
    setCompleteness(c);
    setMissing(m);
    setStep(next);
  };

  return (
    <div>
      <ProgressBar value={completeness} missing={missing} />

      <nav className="flex gap-2 mb-6 flex-wrap">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            disabled={!cardId && i > 0}
            onClick={() => setStep(i)}
            className={`text-[12px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-md border transition-colors ${
              i === step
                ? "border-accent text-accent"
                : "border-hairline text-muted hover:text-foreground"
            } disabled:opacity-40`}
          >
            {i + 1}. {t(`steps.${s}`)}
          </button>
        ))}
      </nav>

      {step === 0 && (
        <StepBasics
          onCreated={(id, site) => {
            setCardId(id);
            setWebsite(site);
            setStep(1);
          }}
        />
      )}

      {step === 1 && cardId && <StepContracts cardId={cardId} onSaved={advance(2)} />}
      {step === 2 && cardId && <StepTokenomics cardId={cardId} onSaved={advance(3)} />}
      {step === 3 && cardId && (
        <StepTrust
          cardId={cardId}
          website={website}
          onSaved={(c, m) => {
            setCompleteness(c);
            setMissing(m);
          }}
          onDone={() => router.push("/cabinet")}
        />
      )}

      {cardId && <p className="text-muted text-xs mt-6">{t("savedNotice")}</p>}
    </div>
  );
}
