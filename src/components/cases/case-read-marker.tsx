"use client";

import { useEffect } from "react";
import { markCaseRead } from "@/app/actions/case-messages";

/**
 * Прочитано — значит открыли нитку. Отметка идёт из эффекта, а не из рендера:
 * изменять данные во время отрисовки серверного компонента нельзя.
 */
export function CaseReadMarker({ caseId }: { caseId: string }) {
  useEffect(() => {
    void markCaseRead({ caseId });
  }, [caseId]);
  return null;
}
