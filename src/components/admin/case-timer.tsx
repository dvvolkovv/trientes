"use client";

import { useEffect } from "react";
import { caseHeartbeat } from "@/app/actions/cases";
import { BEAT_MS } from "@/lib/cases/time";

/**
 * Биение, пока дело открыто у взявшего его сотрудника. Вкладка в фоне не бьёт:
 * время в руках не должно капать, пока человек смотрит в другое окно.
 */
export function CaseTimer({ caseId }: { caseId: string }) {
  useEffect(() => {
    let alive = true;
    const beat = () => {
      if (!alive || document.visibilityState !== "visible") return;
      void caseHeartbeat({ caseId });
    };
    beat();
    const timer = setInterval(beat, BEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [caseId]);

  return null;
}
