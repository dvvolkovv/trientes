"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { claimOsmPoint } from "@/app/actions/point-claim";

export type ClaimCompany = { id: string; name: string };

/**
 * Выбор предприятия и одно нажатие. Поля точки сюда не приходят вовсе: их
 * берёт сервер из нашего зеркала — кнопка говорит «это моё», а не «вот мои
 * данные». Выбор нужен потому, что у человека может быть несколько
 * предприятий, и молча взять первое значило бы решить за него.
 */
export function ClaimPointForm({
  osmKey,
  companies,
  locale,
}: {
  osmKey: string;
  companies: ClaimCompany[];
  locale: string;
}) {
  const t = useTranslations("claimPoint");
  const router = useRouter();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      {companies.length > 1 && (
        <label className="block space-y-1">
          <span className="text-[12px] uppercase tracking-[0.14em] text-muted">
            {t("companyLabel")}
          </span>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        disabled={pending || !companyId}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await claimOsmPoint(companyId, osmKey);
            if (r.ok) {
              router.push(`/${locale}/cabinet/companies/${companyId}/points`);
              router.refresh();
            } else {
              setError(r.reason);
            }
          });
        }}
        className="w-full h-12 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
      >
        {pending ? t("sending") : t("submit")}
      </button>
      {error && <p className="text-red-500 text-[13px]">{t(`error.${error}`)}</p>}
      <p className="text-[12px] leading-snug text-muted">{t("afterNote")}</p>
    </div>
  );
}
