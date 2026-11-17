"use client";

import { useTransition } from "react";
import { claimCase, releaseCase } from "@/app/actions/cases";
import { ADMIN_BUTTON, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";

export function CaseClaim({
  caseId,
  mine,
  taken,
  claimLabel,
  releaseLabel,
  takenLabel,
}: {
  caseId: string;
  mine: boolean;
  taken: boolean;
  claimLabel: string;
  releaseLabel: string;
  takenLabel: string;
}) {
  const [pending, start] = useTransition();

  if (taken && !mine) {
    return <div className="text-center text-[11px] text-muted">{takenLabel}</div>;
  }

  return (
    <button
      type="button"
      disabled={pending}
      className={mine ? ADMIN_BUTTON_SECONDARY : ADMIN_BUTTON}
      onClick={() =>
        start(async () => {
          if (mine) await releaseCase({ caseId });
          else await claimCase({ caseId });
        })
      }
    >
      {mine ? releaseLabel : claimLabel}
    </button>
  );
}
