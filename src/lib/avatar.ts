/**
 * Аватар человека (слайс BT): где лежит файл, как он называется и чем он
 * опознаётся.
 *
 * Отдельного поля в базе нет и не нужно: адрес снимка живёт в `User.image` с
 * фазы 1 — туда же его кладут Google и GitHub, просто до слайса BT его не
 * показывал ни один экран.
 */
import { join } from "node:path";

export const AVATAR_MAX_BYTES = 4 * 1024 * 1024;

export const AVATAR_PUBLIC_PREFIX = "/uploads/avatars/";

/** Корень на диске. Файлы отдаёт nginx, а не Next — см. правило о загрузках. */
export function avatarRoot(): string {
  return process.env.AVATAR_ROOT ?? join(process.cwd(), "public", "uploads", "avatars");
}

/**
 * Что это за картинка — по **первым байтам**, а не по заявленному типу: файл
 * потом отдаёт nginx по расширению, которое придумали мы, и доверять в этом
 * вопросе браузеру нельзя (правило BB). `svg` в список не входит вовсе — это
 * исполняемая разметка с нашего же домена, то есть хранимый XSS.
 */
export function avatarExtension(head: Uint8Array): "png" | "jpg" | "webp" | null {
  const at = (i: number) => head[i] ?? -1;
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  ) {
    return "png";
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpg";
  const ascii = (i: number, s: string) => s.split("").every((c, k) => at(i + k) === c.charCodeAt(0));
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "webp";
  return null;
}

/** Публичный адрес записанного файла. */
export function avatarUrl(userId: string, name: string): string {
  return `${AVATAR_PUBLIC_PREFIX}${userId}/${name}`;
}

/**
 * Путь на диске у **нашего** файла этого человека — или `null`.
 *
 * Чужой адрес (снимок Google) и чужой каталог не наши: стирать по ним нечего, и
 * сборка пути из того, что лежит в базе, без этой проверки была бы дорогой к
 * выходу из каталога.
 */
export function avatarFilePath(image: string | null, userId: string): string | null {
  if (!image) return null;
  const prefix = `${AVATAR_PUBLIC_PREFIX}${userId}/`;
  if (!image.startsWith(prefix)) return null;
  const name = image.slice(prefix.length);
  if (!/^[0-9a-f]{24}\.(png|jpg|webp)$/.test(name)) return null;
  return join(avatarRoot(), userId, name);
}
