/**
 * Публичные документы предприятия (слайс BU).
 *
 * Прямая противоположность KYB: тот приватен (уставы и паспорта лежат вне
 * публичных корней, отдаёт их маршрут с проверкой права), а эти бумаги **должны**
 * светиться на витрине — политика возврата, гарантия, лицензия, сертификат.
 * Поэтому корень публичный, и форма говорит это вслух: рядом, на той же странице
 * предприятия, живёт форма KYB, и перепутать их значит опубликовать паспорт.
 */

import { join } from "node:path";

export const COMPANY_DOC_KINDS = [
  "returnPolicy",
  "privacy",
  "terms",
  "warranty",
  "delivery",
  "license",
  "certificate",
  "other",
] as const;

export type CompanyDocKind = (typeof COMPANY_DOC_KINDS)[number];

/**
 * Прейскуранта в реестре нет намеренно: цена живёт в предложении продавца (BC), и
 * pdf с ценами рядом с живой ценой — два источника одной правды.
 */
export function isCompanyDocKind(v: string | null | undefined): v is CompanyDocKind {
  return !!v && (COMPANY_DOC_KINDS as readonly string[]).includes(v);
}

/** Потолок: это бумаги предприятия, а не его архив. */
export const COMPANY_DOCS_MAX = 20;

export const COMPANY_DOC_TITLE_MAX = 80;

/** Длина своей рубрики — как у своей отрасли: это название, а не описание. */
export const COMPANY_DOC_RUBRIC_MAX = 40;

export type DocRubricResult =
  | { ok: true; kind: CompanyDocKind; kindCustom: string | null }
  | { ok: false; reason: "kind_invalid" | "rubric_required" | "rubric_too_long" | "rubric_has_link" };

/**
 * Рубрика документа (слайс BV): ключ закрытого реестра — или своё слово при `other`.
 *
 * Дословно приём отрасли (`industry` / `industryCustom`, BU): закрытый реестр для того,
 * что мы понимаем кодом, свободное слово для всего прочего. Выдуманный ключ отвергаем
 * — он попал бы на витрину как наша рубрика; ссылку в своём названии тоже (правило BG:
 * текст выходит с нашего домена, значит за ссылку в нём отвечаем мы).
 *
 * Пустое своё название при `other` законно: это и есть рубрика «прочее».
 */
export function normalizeDocRubric(
  kind: string | null | undefined,
  kindCustom: string | null | undefined,
  hasLink: (text: string) => boolean,
): DocRubricResult {
  if (!isCompanyDocKind(kind)) return { ok: false, reason: "kind_invalid" };
  if (kind !== "other") return { ok: true, kind, kindCustom: null };
  const custom = (kindCustom ?? "").trim().replace(/\s+/g, " ");
  if (custom === "") return { ok: true, kind, kindCustom: null };
  if (custom.length > COMPANY_DOC_RUBRIC_MAX) return { ok: false, reason: "rubric_too_long" };
  if (hasLink(custom)) return { ok: false, reason: "rubric_has_link" };
  return { ok: true, kind, kindCustom: custom };
}

/**
 * Ключ группировки на витрине и в кабинете. Своя рубрика группируется по **своему
 * названию без учёта регистра и пробелов**: «Лицензия НБУ» и «лицензия нбу» — одна
 * рубрика, иначе опечатка в регистре делит бумаги предприятия надвое.
 */
export function docRubricKey(kind: string, kindCustom: string | null | undefined): string {
  if (kind === "other" && kindCustom) return `custom:${kindCustom.trim().toLowerCase()}`;
  return `kind:${kind}`;
}

/** Ссылка под документом — только http(s): наш домен за неё отвечает. */
export function isDocLink(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Устав в pdf толще картинки, поэтому предел больше логотипного. */
export const COMPANY_DOC_MAX_BYTES = 10 * 1024 * 1024;

export const COMPANY_DOCS_PUBLIC_PREFIX = "/uploads/company-docs/";

/** Корень на диске. Файл отдаёт nginx — правило проекта о загрузках. */
export function companyDocsRoot(): string {
  return process.env.COMPANY_DOCS_ROOT ?? join(process.cwd(), "public", "uploads", "company-docs");
}

/**
 * Тип файла — по **первым байтам** (правило BB и BT). `svg` в список не входит:
 * исполняемая разметка с нашего домена это хранимый XSS, и «документ» тут не
 * оправдание.
 */
export function companyDocExtension(head: Uint8Array): "pdf" | "png" | "jpg" | "webp" | null {
  const at = (i: number) => head[i] ?? -1;
  const ascii = (i: number, s: string) => s.split("").every((c, k) => at(i + k) === c.charCodeAt(0));
  if (ascii(0, "%PDF")) return "pdf";
  if (
    at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
    at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a
  ) {
    return "png";
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpg";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "webp";
  return null;
}

export function companyDocUrl(companyId: string, name: string): string {
  return `${COMPANY_DOCS_PUBLIC_PREFIX}${companyId}/${name}`;
}

/** Путь на диске у **нашего** файла этого предприятия — или `null` (как в BT). */
export function companyDocFilePath(url: string | null, companyId: string): string | null {
  if (!url) return null;
  const prefix = `${COMPANY_DOCS_PUBLIC_PREFIX}${companyId}/`;
  if (!url.startsWith(prefix)) return null;
  const name = url.slice(prefix.length);
  if (!/^[0-9a-f]{24}\.(pdf|png|jpg|webp)$/.test(name)) return null;
  return join(companyDocsRoot(), companyId, name);
}
