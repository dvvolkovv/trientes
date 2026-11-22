"use client";

import { useEffect } from "react";
import { CABINET_HASH_ALIASES } from "@/lib/cabinet/personal-nav";

/**
 * Старые якоря кабинета (`/cabinet#settings`) живут в письмах и чужих закладках,
 * а разделы переехали на свои адреса. Хеш на сервер не отправляется вовсе,
 * поэтому перевести его может только браузер.
 *
 * Эффектом, а не встроенным `<script>`: сырая разметка в проекте разрешена
 * только для JSON-LD (граница — `tests/json-ld.test.ts`), и заводить ради
 * перевода закладки исключение в правиле, которое охраняет весь сайт от
 * вставки разметки, нельзя. Цена — хаб мелькнёт перед переходом; это дешевле
 * исключения.
 *
 * `replace`, а не `push`: якорь — прежний адрес той же вещи, и кнопка «назад»
 * не должна возвращать человека в него.
 */
export function CabinetHashRedirect({ locale }: { locale: string }) {
  useEffect(() => {
    const key = window.location.hash.replace(/^#/, "");
    const target = CABINET_HASH_ALIASES[key];
    if (!target) return;
    window.location.replace(`/${locale}/cabinet/${target}`);
  }, [locale]);
  return null;
}
