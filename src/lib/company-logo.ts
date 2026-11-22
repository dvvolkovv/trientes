/**
 * Логотип предприятия (слайс BU): где лежит файл, какой он формы и как
 * вписывается в окно.
 *
 * Правило вида живёт **в одном месте** и читается кабинетом, публичной карточкой,
 * каталогом предприятий и витриной товара. Своя копия правила в проекте уже
 * однажды отставала (список локалей, уборка AU) — поэтому модуль один и накрыт
 * тестом.
 *
 * Центровка здесь не настройка, а правило: у логотипов разные пропорции, и
 * «отцентровать» значит одно поведение на все формы, а не поле отступа у каждого
 * предприятия.
 */

import { join } from "node:path";

export const LOGO_SHAPES = ["square", "rounded", "circle"] as const;
export type LogoShape = (typeof LOGO_SHAPES)[number];

/** `contain` — вписать целиком (видны поля), `cover` — заполнить с обрезкой. */
export const LOGO_FITS = ["contain", "cover"] as const;
export type LogoFit = (typeof LOGO_FITS)[number];

export const DEFAULT_LOGO_SHAPE: LogoShape = "rounded";
export const DEFAULT_LOGO_FIT: LogoFit = "contain";

export function isLogoShape(v: string | null | undefined): v is LogoShape {
  return !!v && (LOGO_SHAPES as readonly string[]).includes(v);
}

export function isLogoFit(v: string | null | undefined): v is LogoFit {
  return !!v && (LOGO_FITS as readonly string[]).includes(v);
}

export function logoShapeOf(v: string | null | undefined): LogoShape {
  return isLogoShape(v) ? v : DEFAULT_LOGO_SHAPE;
}

export function logoFitOf(v: string | null | undefined): LogoFit {
  return isLogoFit(v) ? v : DEFAULT_LOGO_FIT;
}

/**
 * Классы окна логотипа. Размер задаёт вызывающий (`h-12 w-12`), а форма,
 * подложка и центровка — здесь: окно всегда квадратное, картинка всегда по
 * середине обеих осей.
 */
export function logoBoxClass(shape: string | null | undefined): string {
  const radius =
    logoShapeOf(shape) === "circle"
      ? "rounded-full"
      : logoShapeOf(shape) === "square"
        ? "rounded-none"
        : "rounded-[14px]";
  return `grid place-items-center overflow-hidden border border-hairline bg-bg-tint ${radius}`;
}

/** Классы самой картинки внутри окна. */
export function logoImageClass(fit: string | null | undefined): string {
  return logoFitOf(fit) === "cover" ? "h-full w-full object-cover" : "h-full w-full object-contain p-1";
}

// ——— загрузка файла ———

export const COMPANY_LOGO_MAX_BYTES = 4 * 1024 * 1024;

export const COMPANY_LOGO_PUBLIC_PREFIX = "/uploads/companies/";

/** Корень на диске. Файлы отдаёт nginx, а не Next — правило проекта о загрузках. */
export function companyLogoRoot(): string {
  return process.env.COMPANY_LOGO_ROOT ?? join(process.cwd(), "public", "uploads", "companies");
}

/**
 * Что это за картинка — по **первым байтам**, а не по заявленному типу: файл
 * потом отдаёт nginx по расширению, которое придумали мы (правило BB и BT).
 * `svg` в список не входит вовсе — это исполняемая разметка с нашего же домена.
 */
export function companyLogoExtension(head: Uint8Array): "png" | "jpg" | "webp" | null {
  const at = (i: number) => head[i] ?? -1;
  if (
    at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 &&
    at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a
  ) {
    return "png";
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpg";
  const ascii = (i: number, s: string) => s.split("").every((c, k) => at(i + k) === c.charCodeAt(0));
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "webp";
  return null;
}

export function companyLogoUrl(companyId: string, name: string): string {
  return `${COMPANY_LOGO_PUBLIC_PREFIX}${companyId}/${name}`;
}

/**
 * Путь на диске у **нашего** файла этого предприятия — или `null`. Чужой адрес
 * (логотип с сайта заведения) и чужой каталог не наши: стирать по ним нечего, а
 * сборка пути из того, что лежит в базе, без этой проверки была бы дорогой к
 * выходу из каталога.
 */
export function companyLogoFilePath(logoUrl: string | null, companyId: string): string | null {
  if (!logoUrl) return null;
  const prefix = `${COMPANY_LOGO_PUBLIC_PREFIX}${companyId}/`;
  if (!logoUrl.startsWith(prefix)) return null;
  const name = logoUrl.slice(prefix.length);
  if (!/^[0-9a-f]{24}\.(png|jpg|webp)$/.test(name)) return null;
  return join(companyLogoRoot(), companyId, name);
}
