"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createWebhook, deleteWebhook, setWebhookEnabled } from "@/app/actions/automation";
import { ADMIN_BUTTON, ADMIN_BUTTON_DANGER, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";
import { AUTOMATION_EVENTS, type AutomationEvent } from "@/lib/automation/events";
import { MAX_WEBHOOKS } from "@/lib/automation/webhooks";

export type WebhookRow = {
  id: string;
  url: string;
  events: AutomationEvent[];
  enabled: boolean;
  createdAt: string;
  lastDeliveredAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  deliveries: {
    id: string;
    kind: string;
    status: string;
    attempts: number;
    lastStatus: number | null;
    lastError: string | null;
    createdAt: string;
  }[];
};

/**
 * Исходящие оповещения (слайс CO, ТЗ 6.7). Раздел виден **только владельцу**: данные
 * уходят за пределы платформы, то есть это выдача прав, а не работа с данными (дословно
 * решение CL о ключах API).
 *
 * Секрет подписи показывается **один раз** — повторно его не узнать, и об этом сказано
 * строкой рядом, а не умолчано.
 */
export function WebhooksPanel({
  companyId,
  hooks,
  locale,
}: {
  companyId: string;
  hooks: WebhookRow[];
  locale: string;
}) {
  const t = useTranslations("cabinetAutomation");
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<AutomationEvent[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const field = "min-h-11 w-full rounded-[12px] border border-hairline bg-card px-3 py-2 text-[14px]";
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

  function create() {
    setError(null);
    setFresh(null);
    start(async () => {
      const r = await createWebhook(companyId, { url, events: picked });
      if (r.ok) {
        setFresh(r.secret);
        setUrl("");
        setPicked([]);
        router.refresh();
      } else {
        setError(t(`error.${r.reason}` as never));
      }
    });
  }

  function toggle(row: WebhookRow) {
    setError(null);
    start(async () => {
      const r = await setWebhookEnabled(companyId, row.id, !row.enabled);
      if (r.ok) router.refresh();
      else setError(t(`error.${r.reason}` as never));
    });
  }

  function remove(id: string) {
    setError(null);
    start(async () => {
      const r = await deleteWebhook(companyId, id);
      if (r.ok) {
        setRemoving(null);
        router.refresh();
      } else {
        setError(t(`error.${r.reason}` as never));
      }
    });
  }

  return (
    <section className="mt-9">
      <h2 className="mb-2 text-[12px] uppercase tracking-[0.2em] text-muted">{t("hooks.heading")}</h2>
      <p className="mb-3 text-[12.5px] leading-snug text-muted">{t("hooks.hint")}</p>
      <p className="mb-4 rounded-[12px] border border-hairline bg-card p-3 text-[12px] leading-snug text-muted">
        {t("hooks.readOnlyNote")}
      </p>

      {hooks.length > 0 ? (
        <ul className="mb-4 flex flex-col gap-2">
          {hooks.map((row) => (
            <li key={row.id} className="rounded-[14px] border border-hairline bg-card p-3">
              <p className="break-all text-[13px] font-medium">{row.url}</p>
              <p className="mt-1 text-[11.5px] leading-snug text-muted">
                {row.events.map((e) => t(`trigger.${e}` as never)).join(" · ")}
              </p>
              <p className="mt-1 text-[11.5px] leading-snug text-muted">
                {row.enabled ? t("rules.enabled") : t("rules.disabled")}
                {" · "}
                {row.lastDeliveredAt ? t("hooks.lastDelivered", { at: when(row.lastDeliveredAt) }) : t("hooks.never")}
              </p>
              {row.lastError ? (
                <p className="mt-1 break-words text-[11.5px] leading-snug text-down">
                  {t("hooks.lastError", { error: row.lastError })}
                </p>
              ) : null}

              {row.deliveries.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1">
                  {row.deliveries.map((d) => (
                    <li key={d.id} className="text-[11.5px] leading-snug text-muted">
                      {when(d.createdAt)} · {t(`trigger.${d.kind}` as never)} ·{" "}
                      {t(`hooks.status.${d.status}` as never)}
                      {d.lastStatus ? ` · HTTP ${d.lastStatus}` : ""}
                      {d.attempts > 1 ? ` · ${t("hooks.attempts", { count: d.attempts })}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button className={ADMIN_BUTTON_SECONDARY} disabled={pending} onClick={() => toggle(row)}>
                  {row.enabled ? t("rules.disable") : t("rules.enable")}
                </button>
                {removing === row.id ? (
                  <button className={ADMIN_BUTTON_DANGER} disabled={pending} onClick={() => remove(row.id)}>
                    {t("rules.deleteConfirm")}
                  </button>
                ) : (
                  <button className={ADMIN_BUTTON_DANGER} disabled={pending} onClick={() => setRemoving(row.id)}>
                    {t("rules.delete")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {fresh ? (
        <div className="mb-4 rounded-[12px] border border-accent bg-accent/10 p-3">
          <p className="text-[12.5px] font-semibold">{t("hooks.freshHeading")}</p>
          <code className="mt-2 block break-all rounded-[10px] border border-hairline bg-card p-2 text-[12px]">
            {fresh}
          </code>
          <p className="mt-2 text-[11.5px] leading-snug text-muted">{t("hooks.freshOnce")}</p>
        </div>
      ) : null}

      {hooks.length >= MAX_WEBHOOKS ? (
        <p className="rounded-[12px] border border-hairline bg-card p-3 text-[12.5px] leading-snug text-muted">
          {t("error.too_many")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="text-[11.5px] text-muted" htmlFor="hook-url">
            {t("hooks.url")}
          </label>
          <input
            id="hook-url"
            className={field}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.org/trientes"
            inputMode="url"
          />
          <p className="text-[11.5px] text-muted">{t("hooks.events")}</p>
          <div className="flex flex-wrap gap-2">
            {AUTOMATION_EVENTS.map((kind) => {
              const on = picked.includes(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setPicked(on ? picked.filter((k) => k !== kind) : [...picked, kind])}
                  className={`min-h-11 rounded-[12px] border px-3 text-[13px] ${
                    on ? "border-accent bg-accent/10" : "border-hairline"
                  }`}
                >
                  {t(`trigger.${kind}` as never)}
                </button>
              );
            })}
          </div>
          <button
            className={ADMIN_BUTTON}
            disabled={pending || url.trim().length < 8 || picked.length === 0}
            onClick={create}
          >
            {t("hooks.create")}
          </button>
        </div>
      )}

      {error ? <p className="mt-2 text-[12.5px] text-down">{error}</p> : null}

      <div className="mt-4 rounded-[12px] border border-hairline bg-card p-3">
        <p className="text-[12px] font-semibold">{t("hooks.docsHeading")}</p>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-[11.5px] leading-snug text-muted">
{`POST <ваш адрес>
X-Trientes-Event: SALE_RECORDED
X-Trientes-Signature: t=<unix>,v1=<hmac_sha256("<t>.<тело>")>

GET /api/merchant/v1/events?limit=50
Authorization: Bearer tri_…`}
        </pre>
        <p className="mt-2 text-[11.5px] leading-snug text-muted">{t("hooks.docsNote")}</p>
      </div>
    </section>
  );
}
