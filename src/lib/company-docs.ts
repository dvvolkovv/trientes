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
