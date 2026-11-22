"use client";

import { useEffect, useState } from "react";
import type { CompanyCardView } from "@/lib/company-card/view";

/**
 * Карточка предприятия для навигатора (слайс BY): один запрос на открытие точки.
 *
 * Через фид bbox её не возим — в кадре бывает двести точек, и реклама с реквизитами
 * у каждой раздула бы ответ, который рисует карту. Сбой чтения оставляет карточку
 * без дополнения, а не ломает страницу: точка со своими адресом и часами уже пришла
 * фидом.
 */
export function useCompanyCard(companyId: string | null | undefined, locale: string) {
  const [card, setCard] = useState<CompanyCardView | null>(null);

  useEffect(() => {
    if (!companyId) {
      setCard(null);
      return;
    }
    let alive = true;
    const ac = new AbortController();
    fetch(`/api/company-card/${companyId}?locale=${encodeURIComponent(locale)}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { card?: CompanyCardView } | null) => {
        if (alive) setCard(data?.card ?? null);
      })
      .catch(() => {
        if (alive) setCard(null);
      });
    return () => {
      alive = false;
      ac.abort();
    };
  }, [companyId, locale]);

  return card;
}
