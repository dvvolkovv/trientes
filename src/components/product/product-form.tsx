"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createProduct, findProductByGtin, updateProduct } from "@/app/actions/products";
import { PRODUCT_CATEGORIES } from "@/lib/products/categories";
import { DOCUMENT_KINDS } from "@/lib/products/validate";
import { MAX_ATTRS, MAX_DOCS, MAX_PHOTOS } from "@/lib/products/rules";
import { BarcodeScanButton } from "@/components/barcode/scan-button";
import { DictateButton } from "@/components/product/dictate-button";
import type { ProductFormValues } from "@/lib/products/form-values";

export type { ProductFormValues };

const INPUT = "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm";
const LABEL = "text-[12px] uppercase tracking-[0.14em] text-muted";

/**
 * Форма паспорта: она же заведение, она же правка — иначе две формы разошлись бы полями.
 * У паспорта с чужим хозяином сохранение уходит предложением правки, и об этом сказано
 * словами до нажатия, а не после.
 */
export function ProductForm({
  companyId,
  locale,
  initial,
  mode,
  willPropose,
}: {
  companyId: string;
  locale: string;
  initial: ProductFormValues;
  mode: "create" | "edit";
  willPropose: boolean;
}) {
  const t = useTranslations("cabinetProducts");
  const router = useRouter();
  const [v, setV] = useState<ProductFormValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [duplicateSlug, setDuplicateSlug] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);

  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) =>
    setV((prev) => ({ ...prev, [key]: value }));

  async function upload(slot: "photo" | "video" | "document", file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("companyId", companyId);
      form.set("slot", slot);
      form.set("file", file);
      const res = await fetch("/api/products/media/upload", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(`upload_${data.error ?? "failed"}`);
        return;
      }
      if (slot === "photo") set("photos", [...v.photos, { url: data.url }].slice(0, MAX_PHOTOS));
      else if (slot === "video") set("videoUrl", data.url);
      else set("documents", [...v.documents, { kind: "certificate", url: data.url }].slice(0, MAX_DOCS));
    } finally {
      setUploading(false);
    }
  }

  /** Сначала штрихкод: нашёлся паспорт — ведём в него, а не заводим второй. */
  async function checkGtin(raw: string = v.gtin) {
    setError(null);
    setDuplicateSlug(null);
    const r = await findProductByGtin(raw);
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    if (r.product) {
      setDuplicateSlug(r.product.slug);
      setInfo(null);
      return;
    }
    setInfo("gtin_free");
  }

  function save() {
    setError(null);
    setInfo(null);
    setDuplicateSlug(null);
    start(async () => {
      const payload = { ...v, videoUrl: v.videoUrl ?? "" };
      const r = mode === "create" ? await createProduct(companyId, payload) : await updateProduct(companyId, v.id!, payload);
      if (r.ok) {
        if ("kind" in r && r.kind === "revision") {
          setInfo("proposed");
          router.refresh();
          return;
        }
        const slug = "slug" in r ? (r.slug as string) : null;
        router.push(slug ? `/${locale}/product/${slug}` : `/${locale}/cabinet/companies/${companyId}/products`);
        router.refresh();
        return;
      }
      if ("slug" in r && r.slug) setDuplicateSlug(r.slug as string);
      setError(r.reason);
    });
  }

  return (
    <div className="space-y-5 max-w-[720px]">
      {willPropose ? <p className="text-sm text-muted border border-hairline rounded-md p-3">{t("willPropose")}</p> : null}

      <label className="block space-y-1">
        <span className={LABEL}>{t("field.gtin")}</span>
        <div className="flex flex-wrap gap-2">
          <input value={v.gtin} onChange={(e) => set("gtin", e.target.value)} className={INPUT} inputMode="numeric" />
          {/* Снятый код сразу идёт в проверку: ради неё его и снимали — ответ «паспорт
              уже есть» нужен до того, как человек начнёт набирать описание. */}
          <BarcodeScanButton
            onCode={(code) => {
              set("gtin", code);
              void checkGtin(code);
            }}
          />
          <button type="button" onClick={() => void checkGtin()} className="h-12 px-4 rounded-md border border-hairline text-sm whitespace-nowrap">
            {t("checkGtin")}
          </button>
        </div>
        <span className="block text-[11px] text-muted">{t("gtinHint")}</span>
      </label>

      {duplicateSlug ? (
        <p className="text-sm">
          {t("gtinTaken")}{" "}
          <a href={`/${locale}/product/${duplicateSlug}`} className="text-accent">
            {t("openPassport")}
          </a>
        </p>
      ) : null}

      <label className="block space-y-1">
        <span className={LABEL}>{t("field.name")}</span>
        <input value={v.name} onChange={(e) => set("name", e.target.value)} className={INPUT} maxLength={120} />
      </label>

      <div className="grid md:grid-cols-2 gap-4">
        <label className="block space-y-1">
          <span className={LABEL}>{t("field.brand")}</span>
          <input value={v.brand} onChange={(e) => set("brand", e.target.value)} className={INPUT} maxLength={120} />
        </label>
        <label className="block space-y-1">
          <span className={LABEL}>{t("field.manufacturerName")}</span>
          <input
            value={v.manufacturerName}
            onChange={(e) => set("manufacturerName", e.target.value)}
            className={INPUT}
            maxLength={120}
          />
        </label>
        <label className="block space-y-1">
          <span className={LABEL}>{t("field.category")}</span>
          <select value={v.category} onChange={(e) => set("category", e.target.value)} className={INPUT}>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`category.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className={LABEL}>{t("field.language")}</span>
          <input value={v.language} onChange={(e) => set("language", e.target.value)} className={INPUT} maxLength={5} />
          <span className="block text-[11px] text-muted">{t("languageHint")}</span>
        </label>
      </div>

      <div className="space-y-2">
        <label className="block space-y-1">
          <span className={LABEL}>{t("field.description")}</span>
          <textarea value={v.description} onChange={(e) => set("description", e.target.value)} rows={5} className={INPUT} />
        </label>
        {/* Кнопка диктовки — рядом с полем, а не внутри подписи: нажатие на подпись
            отдаёт палец полю, и микрофон из неё было бы не нажать. */}
        <DictateButton language={v.language} value={v.description} onChange={(next) => set("description", next)} />
      </div>

      <div className="space-y-2">
        <label className="block space-y-1">
          <span className={LABEL}>{t("field.usage")}</span>
          <textarea value={v.usage} onChange={(e) => set("usage", e.target.value)} rows={3} className={INPUT} />
        </label>
        {/* Кнопка диктовки — рядом с полем, а не внутри подписи: нажатие на подпись
            отдаёт палец полю, и микрофон из неё было бы не нажать. */}
        <DictateButton language={v.language} value={v.usage} onChange={(next) => set("usage", next)} />
      </div>

      <div className="space-y-2">
        <label className="block space-y-1">
          <span className={LABEL}>{t("field.ingredients")}</span>
          <textarea value={v.ingredients} onChange={(e) => set("ingredients", e.target.value)} rows={3} className={INPUT} />
        </label>
        {/* Кнопка диктовки — рядом с полем, а не внутри подписи: нажатие на подпись
            отдаёт палец полю, и микрофон из неё было бы не нажать. */}
        <DictateButton language={v.language} value={v.ingredients} onChange={(next) => set("ingredients", next)} />
      </div>

      <section className="space-y-2">
        <span className={LABEL}>{t("field.attributes")}</span>
        {v.attributes.map((a, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={a.key}
              placeholder={t("attrKey")}
              onChange={(e) => {
                const next = [...v.attributes];
                next[i] = { ...next[i], key: e.target.value };
                set("attributes", next);
              }}
              className={INPUT}
            />
            <input
              value={a.value}
              placeholder={t("attrValue")}
              onChange={(e) => {
                const next = [...v.attributes];
                next[i] = { ...next[i], value: e.target.value };
                set("attributes", next);
              }}
              className={INPUT}
            />
            <input
              value={a.unit ?? ""}
              placeholder={t("attrUnit")}
              onChange={(e) => {
                const next = [...v.attributes];
                next[i] = { ...next[i], unit: e.target.value };
                set("attributes", next);
              }}
              className="w-24 bg-card border border-hairline rounded-md px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => set("attributes", v.attributes.filter((_, j) => j !== i))}
              className="h-12 px-3 rounded-md border border-hairline text-sm"
              aria-label={t("remove")}
            >
              ✕
            </button>
          </div>
        ))}
        {v.attributes.length < MAX_ATTRS ? (
          <button
            type="button"
            onClick={() => set("attributes", [...v.attributes, { key: "", value: "" }])}
            className="h-12 px-4 rounded-md border border-hairline text-sm"
          >
            {t("addAttribute")}
          </button>
        ) : null}
      </section>

      <section className="space-y-2">
        <span className={LABEL}>{t("field.photos")}</span>
        <div className="flex flex-wrap gap-2">
          {v.photos.map((p, i) => (
            <div key={p.url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="w-20 h-20 object-cover rounded-md border border-hairline" />
              <button
                type="button"
                onClick={() => set("photos", v.photos.filter((_, j) => j !== i))}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-card border border-hairline text-xs"
                aria-label={t("remove")}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {v.photos.length < MAX_PHOTOS ? (
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload("photo", f);
              e.target.value = "";
            }}
            className="text-sm"
          />
        ) : null}
      </section>

      <section className="space-y-2">
        <span className={LABEL}>{t("field.video")}</span>
        {v.videoUrl ? (
          <div className="space-y-2">
            <video src={v.videoUrl} controls className="w-full max-w-[320px] rounded-md" />
            <button type="button" onClick={() => set("videoUrl", null)} className="h-12 px-4 rounded-md border border-hairline text-sm">
              {t("removeVideo")}
            </button>
          </div>
        ) : (
          <>
            <input
              type="file"
              accept="video/mp4"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload("video", f);
                e.target.value = "";
              }}
              className="text-sm"
            />
            <span className="block text-[11px] text-muted">{t("videoHint")}</span>
          </>
        )}
      </section>

      <section className="space-y-2">
        <span className={LABEL}>{t("field.documents")}</span>
        {v.documents.map((d, i) => (
          <div key={d.url} className="flex gap-2 items-center">
            <select
              value={d.kind}
              onChange={(e) => {
                const next = [...v.documents];
                next[i] = { ...next[i], kind: e.target.value };
                set("documents", next);
              }}
              className={INPUT}
            >
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`documentKind.${k}`)}
                </option>
              ))}
            </select>
            <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent whitespace-nowrap">
              {t("openFile")}
            </a>
            <button
              type="button"
              onClick={() => set("documents", v.documents.filter((_, j) => j !== i))}
              className="h-12 px-3 rounded-md border border-hairline text-sm"
              aria-label={t("remove")}
            >
              ✕
            </button>
          </div>
        ))}
        {v.documents.length < MAX_DOCS ? (
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload("document", f);
              e.target.value = "";
            }}
            className="text-sm"
          />
        ) : null}
      </section>

      {error ? <p className="text-red-500 text-[13px]">{t(`error.${error}`)}</p> : null}
      {info ? <p className="text-accent text-[13px]">{t(`info.${info}`)}</p> : null}

      <button
        type="button"
        onClick={save}
        disabled={pending || uploading}
        className="w-full h-12 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
      >
        {pending ? t("saving") : willPropose ? t("propose") : t("save")}
      </button>
    </div>
  );
}
