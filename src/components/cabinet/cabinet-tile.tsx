import Link from "next/link";
import { ADMIN_TILE } from "@/lib/admin-ui";

/**
 * Плитка кабинета предприятия (слайс BM). Вид взят из `ADMIN_TILE` — того же
 * модуля, которым сделаны плитки очередей в AN и который владелец одобрил: вторая
 * копия правил вида разошлась бы с первой.
 *
 * Плитка квадратная, и это важно для телефона: две в ряд дают палец шириной
 * примерно в половину экрана, а не ленту пилюль высотой 28 px, в которую надо
 * попасть («пальцем в слово не попасть», правило AN).
 */
export function CabinetTile({
  href,
  icon,
  label,
  value,
  hint,
  badge,
  colorHex,
}: {
  href: string;
  icon: string;
  label: string;
  /** Число на плитке. `null` — числа у этой плитки нет (группа, например). */
  value?: number | null;
  /** Строка под подписью: «ещё не заведено», перечисление разделов группы. */
  hint?: string | null;
  /** Жёлтая метка в углу: «2 на модерации», «1 просрочена». */
  badge?: string | null;
  colorHex?: string | null;
}) {
  return (
    <Link
      href={href}
      // Цвет из закрытой палитры, не из ввода человека, поэтому он идёт стилем:
      // Tailwind не умеет классов, которых нет при сборке.
      style={colorHex ? { borderColor: colorHex } : undefined}
      className={`${ADMIN_TILE} @container transition-colors hover:border-accent/60`}
    >
      {badge ? (
        <span className="absolute right-3 top-3 max-w-[80%] truncate rounded-full bg-accent px-2 py-0.5 text-[10.5px] font-bold text-accent-foreground">
          {badge}
        </span>
      ) : null}
      <div
        style={colorHex ? { backgroundColor: `${colorHex}26` } : undefined}
        className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-card-alt text-base"
      >
        {icon}
      </div>
      <div>
        {value !== null && value !== undefined ? (
          <div
            className={
              value > 0
                ? "text-[34px] font-bold leading-none tracking-[-0.04em]"
                : "text-[26px] font-semibold leading-none text-muted"
            }
          >
            {value}
          </div>
        ) : null}
        <div className="mt-1 text-[13px] font-semibold leading-tight">{label}</div>
        {hint ? <div className="mt-0.5 text-[10.5px] leading-snug text-muted">{hint}</div> : null}
      </div>
    </Link>
  );
}

/** Сетка плиток: две в ряд на телефоне, шире — больше. Та же, что в очередях. */
export const TILE_GRID = "grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4";
