/**
 * Логотип в картинке превью для соцсетей.
 *
 * Превью рисует `ImageResponse` (satori), и относительного адреса он не знает:
 * `<img src="/uploads/...">` обрывает отрисовку целиком, а снаружи это 502 —
 * то есть ссылка, пересланная в мессенджер, остаётся без картинки. Живой
 * случай 27.11.2026: превью карточки предприятия с нашим логотипом отвечало
 * 502 («Image source must be an absolute URL») — у монет и бирж логотипы
 * чужие и абсолютные, поэтому дефект дожил до первого предприятия со своим
 * логотипом.
 *
 * Наш файл читается **с диска**, а не по своему же адресу через nginx: веб,
 * спрашивающий себя, — лишняя точка отказа ровно там, где картинку ждёт чужой
 * паук, и в разработке его публичного адреса может не быть вовсе.
 *
 * Тип читается по **первым байтам** (правило BB и `src/lib/avatar.ts`): имя
 * файла придумываем мы, но подпись доказывает содержимое. `svg` в список не
 * входит — это исполняемая разметка.
 */
import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";

/** Публичные корни загрузок — те же, что отдаёт nginx. Приватных тут нет. */
export type LogoRoots = Partial<Record<string, string>>;

const fallback = (name: string) => join(process.cwd(), "public", "uploads", name);

export function publicUploadRoots(): LogoRoots {
  return {
    companies: process.env.COMPANY_LOGO_ROOT ?? fallback("companies"),
    "coin-cards": process.env.COIN_CARD_LOGO_ROOT ?? fallback("coin-cards"),
    points: process.env.POINT_PHOTOS_ROOT ?? fallback("points"),
    products: process.env.PRODUCT_MEDIA_ROOT ?? fallback("products"),
    avatars: process.env.AVATAR_ROOT ?? fallback("avatars"),
    ads: process.env.AD_MEDIA_ROOT ?? fallback("ads"),
  };
}

function mimeOf(head: Uint8Array): string | null {
  const at = (i: number) => head[i] ?? -1;
  const ascii = (i: number, s: string) => s.split("").every((c, k) => at(i + k) === c.charCodeAt(0));
  if (ascii(0, "\x89PNG") && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) {
    return "image/png";
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(0, "GIF8")) return "image/gif";
  return null;
}

/**
 * Что отдать satori: чужой адрес — как есть, наш файл — data URI, всё
 * остальное — `null`, и тогда превью рисует букву названия. Пропавший файл,
 * чужой каталог и не-картинка превью не роняют: картинка без логотипа лучше
 * отсутствия картинки.
 */
export async function ogLogoSource(
  logoUrl: string | null | undefined,
  roots: LogoRoots = publicUploadRoots(),
): Promise<string | null> {
  if (!logoUrl) return null;
  if (/^https?:\/\//i.test(logoUrl)) return logoUrl;
  if (logoUrl.startsWith("data:")) return logoUrl;

  const prefix = "/uploads/";
  if (!logoUrl.startsWith(prefix)) return null;
  const rest = logoUrl.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const root = roots[rest.slice(0, slash)];
  if (!root) return null;

  // Путь склеиваем сами и проверяем, что он остался под корнем: имя приходит
  // из базы, но выход из каталога — та же дорога, что у вложений дел (AO).
  const tail = rest.slice(slash + 1);
  const path = normalize(join(root, tail));
  if (path !== join(root, tail) || !path.startsWith(root.endsWith(sep) ? root : root + sep)) return null;

  try {
    const bytes = await readFile(path);
    const mime = mimeOf(bytes.subarray(0, 16));
    if (!mime) return null;
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
