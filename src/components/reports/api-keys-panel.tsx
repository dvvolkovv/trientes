"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createApiKey, revokeApiKey } from "@/app/actions/merchant-api-keys";
import { ADMIN_BUTTON, ADMIN_BUTTON_DANGER } from "@/lib/admin-ui";
import { MAX_API_KEYS } from "@/lib/merchant-api/keys";

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
};

/**
 * Ключи read-only API предприятия (слайс CL). Виден раздел только владельцу: ключ
 * читает все продажи мимо кабинета, то есть это выдача прав.
 *
 * Выданный ключ показывается **один раз** — повторно его не узнать, и об этом сказано
 * строкой рядом, а не умолчано.
 */
export function ApiKeysPanel({
  companyId,
  keys,
  locale,
}: {
  companyId: string;
  keys: ApiKeyRow[];
  locale: string;
}) {
  const t = useTranslations("cabinetReports.api");
  const router = useRouter();
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const live = keys.filter((k) => !k.revokedAt).length;
  const field = "h-11 w-full rounded-[12px] border border-hairline bg-card px-3 text-[13px]";
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

  function create() {
    setError(null);
    setFresh(null);
    start(async () => {
      const r = await createApiKey({ companyId, name });
      if (r.ok) {
        setFresh(r.token);
        setName("");
        router.refresh();
      } else {
        setError(t(`error.${r.reason}` as never));
      }
    });
  }

  function revoke(id: string) {
    setError(null);
    start(async () => {
      const r = await revokeApiKey({ companyId, keyId: id, reason });
      if (r.ok) {
        setRevoking(null);
        setReason("");
        router.refresh();
      } else {
        setError(t(`error.${r.reason}` as never));
      }
    });
  }

  return (
    <section className="mt-9">
      <h2 className="mb-2 text-[12px] uppercase tracking-[0.2em] text-muted">{t("heading")}</h2>
      <p className="mb-3 text-[12.5px] leading-snug text-muted">{t("hint")}</p>

      {keys.length > 0 ? (
        <ul className="mb-4 flex flex-col gap-2">
          {keys.map((k) => (
            <li key={k.id} className="rounded-[12px] border border-hairline bg-card p-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{k.name}</span>
                <code className="shrink-0 text-[11.5px] text-muted">{k.prefix}…</code>
              </div>
              <p className="mt-1 text-[11.5px] leading-snug text-muted">
                {t("created", { at: when(k.createdAt) })}
                {" · "}
                {k.lastUsedAt ? t("lastUsed", { at: when(k.lastUsedAt) }) : t("neverUsed")}
              </p>
              {k.revokedAt ? (
                <p className="mt-1 text-[11.5px] leading-snug text-down">
                  {t("revoked", { at: when(k.revokedAt) })}
                  {k.revokeReason ? ` · ${k.revokeReason}` : ""}
                </p>
              ) : revoking === k.id ? (
                <div className="mt-2 flex flex-col gap-2">
                  <input
                    className={field}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t("reasonPlaceholder")}
                  />
                  <button className={ADMIN_BUTTON_DANGER} disabled={pending} onClick={() => revoke(k.id)}>
                    {t("revokeConfirm")}
                  </button>
                  {/* Отказ стоит у той кнопки, которую нажали: общая строка внизу
                      раздела уезжала за край экрана телефона, и человек читал
                      «ничего не произошло» (та же жалоба, что в BG). */}
                  {error ? <p className="text-[12.5px] text-down">{error}</p> : null}
                </div>
              ) : (
                <button
                  className={`${ADMIN_BUTTON_DANGER} mt-2`}
                  disabled={pending}
                  onClick={() => {
                    setRevoking(k.id);
                    setReason("");
                  }}
                >
                  {t("revoke")}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {fresh ? (
        <div className="mb-4 rounded-[12px] border border-accent bg-accent/10 p-3">
          <p className="text-[12.5px] font-semibold">{t("freshHeading")}</p>
          <code className="mt-2 block break-all rounded-[10px] border border-hairline bg-card p-2 text-[12px]">
            {fresh}
          </code>
          <p className="mt-2 text-[11.5px] leading-snug text-muted">{t("freshOnce")}</p>
        </div>
      ) : null}

      {live >= MAX_API_KEYS ? (
        <p className="rounded-[12px] border border-hairline bg-card p-3 text-[12.5px] leading-snug text-muted">
          {t("error.too_many")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <input
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
          />
          <button className={ADMIN_BUTTON} disabled={pending || name.trim().length < 2} onClick={create}>
            {t("create")}
          </button>
        </div>
      )}

      {error && revoking === null ? <p className="mt-2 text-[12.5px] text-down">{error}</p> : null}

      <div className="mt-4 rounded-[12px] border border-hairline bg-card p-3">
        <p className="text-[12px] font-semibold">{t("docsHeading")}</p>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-[11.5px] leading-snug text-muted">
{`GET /api/merchant/v1/sales?from=2026-11-01&to=2026-11-30&limit=50
GET /api/merchant/v1/summary?from=2026-11-01&to=2026-11-30
Authorization: Bearer tri_…`}
        </pre>
        <p className="mt-2 text-[11.5px] leading-snug text-muted">{t("docsNote")}</p>
      </div>
    </section>
  );
}
