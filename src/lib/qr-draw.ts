/**
 * Символ QR как путь SVG. Чистый модуль: рисование отделено от React, поэтому
 * правило «путь закрашивает ровно тёмные модули» накрыто тестом, а не глазом.
 *
 * Кодировщик (`qr.ts`) и этот рисователь взяты из нашего же репозитория обмена,
 * где они проверяются посимвольно против эталонного кодировщика и читаются
 * независимым декодером: второй реализации QR в двух наших проектах быть не
 * должно.
 */
import { encodeQr } from "@/lib/qr";

/** Светлое поле вокруг символа: без него читатель не находит символ. */
export const QUIET_ZONE = 4;

/** Тёмные модули одним путём: подряд идущие в строке становятся одним прямоугольником. */
export function qrPath(modules: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end]) end++;
      parts.push(`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h${end - x}v1h${x - end}z`);
      x = end;
    }
  });
  return parts.join("");
}

/**
 * Символ текста как путь и сторона вместе со светлым полем. `null` — текст, который
 * символ не вмещает: тогда не рисуется ничего, а ссылка рядом остаётся. Символ части
 * ссылки — это ссылка в другое место, поэтому обрезания нет нигде.
 */
export function qrDrawing(text: string): { d: string; side: number } | null {
  try {
    const q = encodeQr(text);
    return { d: qrPath(q.modules), side: q.size + QUIET_ZONE * 2 };
  } catch {
    return null;
  }
}
