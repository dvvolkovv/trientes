"use client";

import { useMemo, useState } from "react";

/**
 * Выбор монет: один компонент на карточку предприятия и на точку приёма.
 *
 * До слайса BX выбор жил только в форме точки — чипами по 11 px в окне высотой
 * `max-h-32`, без поиска, на сотню монет. Владелец сказал прямо: «нет функции
 * выбрать монету», — и был прав: функция была, найти её было нельзя. Поэтому
 * тут поиск, цель под палец (44 px, правило AN) и выбранные **первыми**: человек
 * приходит сюда проверить, что выбрано, чаще, чем выбрать новое.
 *
 * Второй копии не заводим: две формы об одном и том же разошлись бы по виду
 * через месяц (болезнь списка локалей, уборка AU).
 */

export type PickerCoin = { id: string; symbol: string; name?: string; logoUrl: string | null };

export function CoinPicker({
  coins,
  selected,
  onToggle,
  searchLabel,
  emptyLabel,
  disabled,
}: {
  coins: PickerCoin[];
  selected: string[];
  onToggle: (id: string) => void;
  searchLabel: string;
  emptyLabel: string;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const picked = new Set(selected);
    const match = (c: PickerCoin) =>
      !needle ||
      c.symbol.toLowerCase().includes(needle) ||
      (c.name ?? "").toLowerCase().includes(needle) ||
      c.id.toLowerCase().includes(needle);
    // Выбранное показывается всегда, даже когда не подходит под поиск: иначе
    // набранное слово прятало бы от человека то, что он уже выбрал, и он решил
    // бы, что выбор слетел.
    const on = coins.filter((c) => picked.has(c.id));
    const off = coins.filter((c) => !picked.has(c.id) && match(c));
    return [...on, ...off];
  }, [coins, selected, q]);

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={searchLabel}
        aria-label={searchLabel}
        className="h-11 w-full rounded-[12px] border border-hairline bg-card px-3 text-[14px]"
      />
      <div className="flex max-h-64 flex-wrap gap-2 overflow-y-auto">
        {rows.length === 0 ? <p className="text-[12px] text-muted">{emptyLabel}</p> : null}
        {rows.map((c) => {
          const on = selected.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              title={c.name ?? c.symbol}
              onClick={() => onToggle(c.id)}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-[12px] border px-3 text-[13px] transition-colors ${
                on ? "border-accent bg-accent/15 text-accent" : "border-hairline text-muted"
              }`}
            >
              {c.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.logoUrl} alt="" width={18} height={18} className="rounded-full" />
              ) : null}
              {c.symbol.toUpperCase()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
