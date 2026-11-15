/**
 * Подписка на компас телефона.
 *
 * Отдельно от `heading.ts` ровно потому, что это единственная часть курса,
 * которую нельзя проверить без телефона: разрешение, два разных события и
 * два разных способа назвать север. Арифметика угла живёт рядом, в чистом
 * модуле, и накрыта тестами.
 *
 * На iOS доступ к компасу спрашивается у человека, и спросить можно только из
 * жеста — поэтому `requestCompassPermission` зовётся прямо из нажатия на
 * кнопку компаса, а не из эффекта.
 */

import { compassHeadingFrom } from "@/lib/heading";

type OrientationEventLike = DeviceOrientationEvent & { webkitCompassHeading?: number };

type PermissionCapable = {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
};

export async function requestCompassPermission(): Promise<boolean> {
  if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") return false;
  const api = DeviceOrientationEvent as unknown as PermissionCapable;
  if (typeof api.requestPermission !== "function") return true; // Android и настольные — без спроса
  try {
    return (await api.requestPermission()) === "granted";
  } catch {
    // Спрошено не из жеста либо человек отказал — курс остаётся за GPS.
    return false;
  }
}

/**
 * Слушает компас, пока не позовут возвращённую функцию.
 *
 * Слушаем оба события: `deviceorientationabsolute` даёт курс от севера на
 * Android, `deviceorientation` — на iOS (через `webkitCompassHeading`).
 * Относительная ориентация без севера отсеивается в `compassHeadingFrom`.
 */
export function watchCompass(onHeading: (deg: number) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const o = e as OrientationEventLike;
    const deg = compassHeadingFrom({
      webkitCompassHeading: o.webkitCompassHeading,
      alpha: o.alpha,
      absolute: o.absolute,
    });
    if (deg !== null) onHeading(deg);
  };
  window.addEventListener("deviceorientationabsolute", handler, true);
  window.addEventListener("deviceorientation", handler, true);
  return () => {
    window.removeEventListener("deviceorientationabsolute", handler, true);
    window.removeEventListener("deviceorientation", handler, true);
  };
}
