"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  addCompanyDocument,
  deleteCompanyDocument,
  setCompanyDocumentPublished,
  updateCompanyDocument,
} from "@/app/actions/company-docs";
import {
  COMPANY_DOC_KINDS,
  COMPANY_DOCS_MAX,
  COMPANY_DOC_RUBRIC_MAX,
  docRubricKey,
} from "@/lib/company-docs";

/**
 * Публичные документы предприятия (слайсы BU и BV).
 *
 * Самое важное на экране — не форма, а строка над ней: «эти файлы видит любой
 * человек в интернете». Рядом, на той же странице, живёт форма KYB, куда грузят
 * уставы и паспорта, и отличие двух корней должно быть видно глазом, а не
 * следовать из названия раздела.
 *
 * Рубрика выбирается **плитками**, а не строкой выпадающего списка (правило AN:
 * действие — кнопка под палец). Рубрики, которые предприятие уже завело, стоят
 * своими плитками рядом с реестром: второй документ попадает в ту же рубрику
 * нажатием, а не повторным набором слова — своя рубрика с опечаткой это две
 * рубрики, и подсказка здесь не украшение.
 */

export type DocRow = {
  id: string;
  kind: string;
  kindCustom: string | null;
  title: string | null;
  url: string | null;
  linkUrl: string | null;
  published: boolean;
};

const PILL =
  "min-h-[40px] rounded-[12px] border px-3 text-[12px] leading-[38px] transition-colors";

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
  const [kindCustom, setKindCustom] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const input = "w-full bg-bg-tint border border-hairline rounded-md px-3 py-2 text-[13px]";
  const label = "block text-[11px] uppercase tracking-wider text-muted mb-1";

  /** Свои рубрики этого предприятия — по одной строке на рубрику, без регистра. */
  const ownRubrics = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of docs) {
      if (d.kind !== "other" || !d.kindCustom) continue;
      const key = docRubricKey(d.kind, d.kindCustom);
      if (!seen.has(key)) seen.set(key, d.kindCustom);
    }
    return [...seen.values()];
  }, [docs]);

  const rubricLabel = (d: { kind: string; kindCustom: string | null }) =>
    d.kind === "other" && d.kindCustom ? d.kindCustom : t(`kind.${d.kind}`);

  /** Документы группами: заголовок рубрики, под ним её бумаги. */
  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: DocRow[] }[] = [];
    for (const d of docs) {
      const key = docRubricKey(d.kind, d.kindCustom);
      const found = out.find((g) => g.key === key);
      if (found) found.rows.push(d);
      else out.push({ key, label: rubricLabel(d), rows: [d] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, t]);

  function resetForm() {
    setTitle("");
    setUrl("");
    setLinkUrl("");
  }

  function add(nextUrl: string) {
    setErr(null);
    start(async () => {
      const res = await addCompanyDocument(companyId, {
        kind,
        kindCustom: kind === "other" ? kindCustom : null,
        title,
        url: nextUrl,
        linkUrl,
      });
      if (res.ok) {
        resetForm();
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

  const canAdd = docs.length < COMPANY_DOCS_MAX;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[13px] uppercase tracking-[0.2em] text-muted">{t("title")}</h2>
        <p className="mt-1 text-[12px] text-muted">{t("subtitle")}</p>
      </div>

      {docs.length === 0 ? (
        <p className="text-[13px] text-muted">{t("empty")}</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.key} className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-muted">{g.label}</div>
              <ul className="space-y-2">
                {g.rows.map((d) =>
                  editing === d.id ? (
                    <li key={d.id} className="rounded-md border border-accent/40 bg-card p-3">
                      <DocEditor
                        doc={d}
                        ownRubrics={ownRubrics}
                        onCancel={() => setEditing(null)}
                        onSaved={() => {
                          setEditing(null);
                          router.refresh();
                        }}
                        onError={setErr}
                      />
                    </li>
                  ) : (
                    <li key={d.id} className="rounded-md border border-hairline bg-card p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            d.published ? "bg-green-500/15 text-green-500" : "bg-bg-tint text-muted"
                          }`}
                        >
                          {d.published ? t("published") : t("draft")}
                        </span>
                      </div>
                      {d.url ? (
                        <a
                          href={d.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 block break-words text-[13px] underline-offset-2 hover:underline"
                        >
                          {d.title ?? rubricLabel(d)}
                        </a>
                      ) : (
                        <div className="mt-1 break-words text-[13px]">{d.title ?? rubricLabel(d)}</div>
                      )}
                      {/* Ссылка на реестр — отдельной строкой и своими словами: наш
                          файл подтверждает только то, что продавец его загрузил. */}
                      {d.linkUrl ? (
                        <a
                          href={d.linkUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="mt-0.5 block break-words text-[12px] text-accent underline"
                        >
                          {t("verifyLink")} ↗
                        </a>
                      ) : null}
                      {canEdit ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => setEditing(d.id)}
                            className={`${PILL} border-hairline bg-bg-tint hover:border-accent/50`}
                          >
                            {tb("edit")}
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => togglePublished(d.id, !d.published)}
                            className={`${PILL} border-hairline bg-bg-tint hover:border-accent/50`}
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
                            className={`${PILL} border-hairline bg-bg-tint text-red-400 disabled:opacity-40 hover:border-red-500/50`}
                          >
                            {tb("remove")}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
      )}

      {canEdit ? (
        <div className="space-y-3 rounded-md border border-hairline bg-card-alt p-3">
          <p className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2 text-[12px] text-yellow-500">
            {t("publicWarning")}
          </p>

          <RubricPicker
            kind={kind}
            kindCustom={kindCustom}
            ownRubrics={ownRubrics}
            onKind={setKind}
            onKindCustom={setKindCustom}
          />

          <div>
            <label className={label} htmlFor="doc-title">{t("titleLabel")}</label>
            <input id="doc-title" className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div>
            <label className={label} htmlFor="doc-link">{t("linkLabel")}</label>
            <input
              id="doc-link"
              className={input}
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://…"
            />
            <p className="mt-1 text-[11px] text-muted">{t("linkHint")}</p>
          </div>

          <div>
            <label className={label} htmlFor="doc-file">{t("fileLabel")}</label>
            <input
              id="doc-file"
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              disabled={uploading || pending || !canAdd}
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
            <input
              id="doc-url"
              className={input}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>

          {/* Документ без файла законен — если есть ссылка на реестр. Кнопка
              погашена не молча: правило BG и BI — обманка хуже отказа. */}
          <button
            type="button"
            disabled={pending || uploading || !canAdd || (!url.trim() && !linkUrl.trim())}
            onClick={() => add(url.trim())}
            className="min-h-[48px] w-full rounded-[14px] border border-hairline bg-bg-tint px-3 text-[13px] disabled:opacity-40 hover:border-accent/50"
          >
            {t("addUrl")}
          </button>
          {!canAdd ? <p className="text-[12px] text-muted">{t("err.docs_limit")}</p> : null}
          {canAdd && !url.trim() && !linkUrl.trim() ? (
            <p className="text-[11px] text-muted">{t("addHint")}</p>
          ) : null}
        </div>
      ) : null}

      {err ? <p className="text-[13px] text-red-400">{err}</p> : null}
    </section>
  );
}

/**
 * Выбор рубрики: реестр плитками, затем свои рубрики предприятия, затем «своя
 * рубрика» с полем названия. Своя рубрика нажатием ставит `other` и подставляет
 * слово — иначе человек набирал бы его заново и завёл бы вторую рубрику.
 */
function RubricPicker({
  kind,
  kindCustom,
  ownRubrics,
  onKind,
  onKindCustom,
}: {
  kind: string;
  kindCustom: string;
  ownRubrics: string[];
  onKind: (v: string) => void;
  onKindCustom: (v: string) => void;
}) {
  const t = useTranslations("business.docs");
  const active = "border-accent bg-accent/10 text-accent";
  const idle = "border-hairline bg-bg-tint hover:border-accent/50";
  const ownSelected = kind === "other" && kindCustom.trim() !== "";

  return (
    <div>
      <span className="block text-[11px] uppercase tracking-wider text-muted mb-1">{t("kindLabel")}</span>
      <div className="flex flex-wrap gap-2">
        {COMPANY_DOC_KINDS.filter((k) => k !== "other").map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              onKind(k);
              onKindCustom("");
            }}
            className={`${PILL} ${kind === k ? active : idle}`}
          >
            {t(`kind.${k}`)}
          </button>
        ))}
        {ownRubrics.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => {
              onKind("other");
              onKindCustom(name);
            }}
            className={`${PILL} ${
              kind === "other" && kindCustom.trim().toLowerCase() === name.toLowerCase() ? active : idle
            }`}
          >
            {name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            onKind("other");
            if (ownSelected) onKindCustom("");
          }}
          className={`${PILL} ${kind === "other" && !ownSelected ? active : idle}`}
        >
          + {t("ownRubric")}
        </button>
      </div>
      {kind === "other" ? (
        <div className="mt-2">
          <input
            className="w-full bg-bg-tint border border-hairline rounded-md px-3 py-2 text-[13px]"
            value={kindCustom}
            maxLength={COMPANY_DOC_RUBRIC_MAX}
            onChange={(e) => onKindCustom(e.target.value)}
            placeholder={t("ownRubricPlaceholder")}
          />
          <p className="mt-1 text-[11px] text-muted">{t("ownRubricHint")}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Правка документа на месте: название, рубрика, ссылка. Файл не трогаем. */
function DocEditor({
  doc,
  ownRubrics,
  onCancel,
  onSaved,
  onError,
}: {
  doc: DocRow;
  ownRubrics: string[];
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("business.docs");
  const tb = useTranslations("business");
  const [pending, start] = useTransition();
  const [kind, setKind] = useState(doc.kind);
  const [kindCustom, setKindCustom] = useState(doc.kindCustom ?? "");
  const [title, setTitle] = useState(doc.title ?? "");
  const [linkUrl, setLinkUrl] = useState(doc.linkUrl ?? "");

  const input = "w-full bg-bg-tint border border-hairline rounded-md px-3 py-2 text-[13px]";

  return (
    <div className="space-y-3">
      <RubricPicker
        kind={kind}
        kindCustom={kindCustom}
        ownRubrics={ownRubrics}
        onKind={setKind}
        onKindCustom={setKindCustom}
      />
      <div>
        <label className="block text-[11px] uppercase tracking-wider text-muted mb-1" htmlFor={`doc-title-${doc.id}`}>
          {t("titleLabel")}
        </label>
        <input id={`doc-title-${doc.id}`} className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <label className="block text-[11px] uppercase tracking-wider text-muted mb-1" htmlFor={`doc-link-${doc.id}`}>
          {t("linkLabel")}
        </label>
        <input
          id={`doc-link-${doc.id}`}
          className={input}
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="https://…"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await updateCompanyDocument(doc.id, {
                kind,
                kindCustom: kind === "other" ? kindCustom : null,
                title,
                linkUrl,
              });
              if (res.ok) onSaved();
              else onError(t(`err.${res.reason}`));
            })
          }
          className={`${PILL} border-accent bg-accent/10 text-accent`}
        >
          {tb("saveProfile")}
        </button>
        <button type="button" onClick={onCancel} className={`${PILL} border-hairline bg-bg-tint`}>
          {tb("cancelEdit")}
        </button>
      </div>
    </div>
  );
}
