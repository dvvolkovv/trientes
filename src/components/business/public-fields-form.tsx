"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { saveCompanyPublicFields } from "@/app/actions/company-docs";
import { PUBLIC_FIELD_KEYS, type PublicFieldKey, type PublicFields } from "@/lib/company-public-fields";

/**
 * Что предприятие показывает на витрине (слайс BU).
 *
 * Выключатели стоят только у того, скрытие чего ничего не ломает. Список того,
 * что скрыть нельзя, назван прямо на экране: иначе человек будет искать
 * выключатель юридического имени и решит, что мы его спрятали.
 */
export function PublicFieldsForm({
  companyId,
  initial,
}: {
  companyId: string;
  initial: PublicFields;
}) {
  const t = useTranslations("business.publicFields");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [values, setValues] = useState<PublicFields>(initial);
  const [err, setErr] = useState<string | null>(null);

  function toggle(key: PublicFieldKey) {
    const next = { ...values, [key]: !values[key] };
    setValues(next);
    setErr(null);
    start(async () => {
      const res = await saveCompanyPublicFields(companyId, next);
      if (res.ok) router.refresh();
      else {
        setValues(values);
        setErr(t("err"));
      }
    });
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[13px] uppercase tracking-[0.2em] text-muted">{t("title")}</h2>
        <p className="mt-1 text-[12px] text-muted">{t("subtitle")}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {PUBLIC_FIELD_KEYS.map((key) => {
          const on = values[key];
          return (
            <button
              key={key}
              type="button"
              disabled={pending}
              aria-pressed={on}
              onClick={() => toggle(key)}
              className={`flex min-h-[48px] items-center justify-between gap-3 rounded-[14px] border px-3 text-left text-[13px] transition-colors ${
                on ? "border-accent bg-accent/10" : "border-hairline bg-bg-tint text-muted"
              }`}
            >
              <span>{t(`field.${key}`)}</span>
              <span className="shrink-0 text-[11px] uppercase tracking-wider">
                {on ? t("shown") : t("hidden")}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted">{t("alwaysPublic")}</p>
      {err ? <p className="text-[13px] text-red-400">{err}</p> : null}
    </section>
  );
}
