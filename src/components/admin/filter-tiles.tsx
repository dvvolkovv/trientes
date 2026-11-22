import { ADMIN_FILTER_GRID, ADMIN_FILTER_TILE, adminChoiceLook } from "@/lib/admin-ui";

export type FilterTile = {
  key: string;
  href: string;
  label: string;
  active: boolean;
  /** Число под фильтром. `null` — фильтр не про количество (окно наблюдения). */
  count?: number | null;
  /** Цвет смысла (состояние заявки). Фильтр без смысла цвета не получает. */
  colorHex?: string | null;
};

/**
 * Фильтры внутри раздела админки — плитками в сетке, а не полосой кнопок.
 *
 * Полосу листают вбок, и просьба владельца прямо об этом: «на мобильной версии
 * не очень хорошо, лучше снизу вверх их листать». Сетка переносит плитки вниз —
 * боковой прокрутки не остаётся вовсе, а палец идёт по привычной оси страницы.
 * Полоса разделов в шапке остаётся полосой: она одна на все экраны и должна
 * стоять на месте, а не менять высоту от числа закладок.
 *
 * Число на плитке — та самая «информативная часть»: плитка очереди на
 * `/admin/queues` говорит, сколько дел ждёт, и фильтр обязан говорить столько же.
 * Где числа нет по смыслу (окно наблюдения в аналитике), плитка несёт одну
 * подпись: выдуманное число было бы хуже пустого места.
 *
 * `groups` — у `/admin/business` в фильтрах два смысла (что показываем и в каком
 * состоянии); каждая группа получает свою сетку, иначе две оси смешались бы в
 * одну кучу плиток.
 */
export function AdminFilterTiles({ groups }: { groups: FilterTile[][] }) {
  return (
    <div className="mb-6 space-y-3">
      {groups
        .filter((g) => g.length > 0)
        .map((group) => (
          <div key={group[0].key} className={ADMIN_FILTER_GRID}>
            {group.map((tile) => {
              const look = adminChoiceLook(tile.colorHex, tile.active);
              return (
                <a
                  key={tile.key}
                  href={tile.href}
                  aria-current={tile.active ? "page" : undefined}
                  style={look.style}
                  className={`${ADMIN_FILTER_TILE} ${look.className}`}
                >
                  {typeof tile.count === "number" ? (
                    <span
                      className={
                        tile.count > 0
                          ? "num text-[26px] font-bold leading-none tracking-[-0.04em]"
                          : "num text-[22px] font-semibold leading-none text-muted"
                      }
                    >
                      {tile.count}
                    </span>
                  ) : null}
                  <span className="text-[11px] font-semibold uppercase leading-tight tracking-wider">
                    {tile.label}
                  </span>
                </a>
              );
            })}
          </div>
        ))}
    </div>
  );
}
