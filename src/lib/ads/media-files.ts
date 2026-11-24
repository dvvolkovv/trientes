import { join } from "node:path";

import { isOwnMedia, type AdSlide } from "@/lib/ads/rules";

/**
 * Файлы медиа рекламного материала на диске (слайс CF).
 *
 * Тот же приём, что `companyDocFilePath`: путь строится только для **нашего** файла
 * этого предприятия, а по чужому адресу стирать нечего. Имя придумываем мы
 * (`isOwnMedia`), и оно же — единственная защита пути склейки.
 */
export function adMediaRoot(): string {
  return process.env.AD_MEDIA_ROOT ?? join(process.cwd(), "public", "uploads", "ads");
}

export function adMediaFilePath(url: string | null | undefined, companyId: string): string | null {
  const value = (url ?? "").trim();
  if (!value) return null;
  if (!isOwnMedia(value)) return null;
  const prefix = `/uploads/ads/${companyId}/`;
  if (!value.startsWith(prefix)) return null;
  return join(adMediaRoot(), companyId, value.slice(prefix.length));
}

type MediaRow = {
  mediaUrl?: string | null;
  posterUrl?: string | null;
  audioUrl?: string | null;
  slides?: unknown;
  pendingPayload?: unknown;
};

function pushSlides(out: Set<string>, raw: unknown) {
  if (!Array.isArray(raw)) return;
  for (const item of raw as Partial<AdSlide>[]) {
    if (typeof item?.url === "string") out.add(item.url);
    if (typeof item?.posterUrl === "string") out.add(item.posterUrl);
  }
}

/**
 * Все адреса медиа материала — и из колонок, и из **слепка правки**: слепок хранит
 * форму целиком, и кадр, загруженный для ждущей правки, лежит на диске ровно так же.
 */
export function adMediaUrls(row: MediaRow): string[] {
  const out = new Set<string>();
  for (const v of [row.mediaUrl, row.posterUrl, row.audioUrl]) {
    if (typeof v === "string" && v) out.add(v);
  }
  pushSlides(out, row.slides);
  const pending = row.pendingPayload as MediaRow | null | undefined;
  if (pending && typeof pending === "object") {
    for (const v of [pending.mediaUrl, pending.posterUrl, pending.audioUrl]) {
      if (typeof v === "string" && v) out.add(v);
    }
    pushSlides(out, pending.slides);
  }
  return [...out];
}

/**
 * Что можно стереть: адреса удаляемого материала за вычетом тех, на которые ссылается
 * кто-то ещё. Один и тот же кадр бывает в двух материалах (его загрузили однажды), и
 * удаление первого не должно гасить второй.
 */
export function orphanMediaUrls(doomed: MediaRow, others: MediaRow[]): string[] {
  const keep = new Set(others.flatMap((r) => adMediaUrls(r)));
  return adMediaUrls(doomed).filter((u) => !keep.has(u));
}
