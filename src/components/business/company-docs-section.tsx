"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  addCompanyDocument,
  deleteCompanyDocument,
  setCompanyDocumentPublished,
} from "@/app/actions/company-docs";
import { COMPANY_DOC_KINDS, COMPANY_DOCS_MAX } from "@/lib/company-docs";

/**
 * Публичные документы предприятия (слайс BU).
 *
 * Самое важное на экране — не форма, а строка над ней: «эти файлы видит любой
 * человек в интернете». Рядом, на той же странице, живёт форма KYB, куда грузят
 * уставы и паспорта, и отличие двух корней должно быть видно глазом, а не
 * следовать из названия раздела.
 */

export type DocRow = {
  id: string;
  kind: string;
  title: string | null;
  url: string;
  published: boolean;
};

export function CompanyDocsSection({
  companyId,
  docs,
  canEdit,
}: {
  companyId: string;
  docs: DocRow[];
  canEdit: boolean;
}) {
  const t = useTranslations("business.docs");
  const tb = useTranslations("business");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<string>("returnPolicy");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  const input = "w-full bg-bg-tint border border-hairline rounded-md px-3 py-2 text-[13px]";
  const label = "block text-[11px] uppercase tracking-wider text-muted mb-1";

  function add(nextUrl: string) {
    setErr(null);
    start(async () => {
      const res = await addCompanyDocument(companyId, { kind, title, url: nextUrl });
      if (res.ok) {
        setTitle("");
        setUrl("");
        router.refresh();
      } else setErr(t(`err.${res.reason}`));
    });
  }

  async function upload(file: File) {
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("companyId", companyId);
      fd.append("file", file);
      const res = await fetch("/api/business/document", { method: "POST", body: fd });
      const j = (await res.json()) as { url?: string; error?: string };
      if (res.ok && j.url) add(j.url);
      else setErr(t(`err.${j.error ?? "generic"}`));
    } catch {
      setErr(t("err.generic"));
    } finally {
      setUploading(false);
    }
  }

  function togglePublished(id: string, next: boolean) {
    setErr(null);
    start(async () => {
      const res = await setCompanyDocumentPublished(id, next);
      if (res.ok) router.refresh();
      else setErr(t(`err.${res.reason}`));
    });
  }

  function remove(id: string) {
    setErr(null);
    start(async () => {
      const res = await deleteCompanyDocument(id);
      if (res.ok) router.refresh();
      else setErr(t(`err.${res.reason}`));
    });
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[13px] uppercase tracking-[0.2em] text-muted">{t("title")}</h2>
        <p className="mt-1 text-[12px] text-muted">{t("subtitle")}</p>
      </div>

      {docs.length === 0 ? (
        <p className="text-[13px] text-muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.id} className="rounded-md border border-hairline bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-muted">{t(`kind.${d.kind}`)}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    d.published ? "bg-green-500/15 text-green-500" : "bg-bg-tint text-muted"
                  }`}
                >
                  {d.published ? t("published") : t("draft")}
                </span>
              </div>
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block break-words text-[13px] underline-offset-2 hover:underline"
              >
                {d.title ?? t(`kind.${d.kind}`)}
              </a>
              {canEdit ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => togglePublished(d.id, !d.published)}
                    className="min-h-[36px] rounded-[12px] border border-hairline bg-bg-tint px-3 text-[12px] hover:border-accent/50"
                  >
                    {d.published ? t("unpublish") : t("publish")}
                  </button>
                  {/* Опубликованный документ удаляется только после снятия с
                      витрины: покупатель мог сослаться на обещание. */}
                  <button
                    type="button"
                    disabled={pending || d.published}
                    onClick={() => remove(d.id)}
                    title={d.published ? t("err.unpublish_first") : undefined}
                    className="min-h-[36px] rounded-[12px] border border-hairline bg-bg-tint px-3 text-[12px] text-red-400 disabled:opacity-40 hover:border-red-500/50"
                  >
                    {tb("remove")}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="space-y-3 rounded-md border border-hairline bg-card-alt p-3">
          <p className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2 text-[12px] text-yellow-500">
            {t("publicWarning")}
          </p>
          <div>
            <label className={label} htmlFor="doc-kind">{t("kindLabel")}</label>
            <select id="doc-kind" className={input} value={kind} onChange={(e) => setKind(e.target.value)}>
              {COMPANY_DOC_KINDS.map((k) => (
                <option key={k} value={k}>{t(`kind.${k}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="doc-title">{t("titleLabel")}</label>
            <input id="doc-title" className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="doc-file">{t("fileLabel")}</label>
            <input
              id="doc-file"
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              disabled={uploading || pending || docs.length >= COMPANY_DOCS_MAX}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = "";
              }}
              className="text-[12px]"
            />
            <p className="mt-1 text-[11px] text-muted">{t("fileHint")}</p>
          </div>
          <div>
            <label className={label} htmlFor="doc-url">{t("urlLabel")}</label>
            <div className="flex gap-2">
              <input
                id="doc-url"
                className={input}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
              />
              <button
                type="button"
                disabled={pending || uploading || !url.trim() || docs.length >= COMPANY_DOCS_MAX}
                onClick={() => add(url.trim())}
                className="min-h-[40px] shrink-0 rounded-[12px] border border-hairline bg-bg-tint px-3 text-[12px] disabled:opacity-40 hover:border-accent/50"
              >
                {t("addUrl")}
              </button>
            </div>
          </div>
          {docs.length >= COMPANY_DOCS_MAX ? (
            <p className="text-[12px] text-muted">{t("err.docs_limit")}</p>
          ) : null}
        </div>
      ) : null}

      {err ? <p className="text-[13px] text-red-400">{err}</p> : null}
    </section>
  );
}
