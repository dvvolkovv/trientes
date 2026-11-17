/**
 * Правила вида админки в одном месте, а не россыпью по экранам.
 *
 * Два требования владельца (17.11): действие — всегда кнопка, а не подчёркнутое
 * слово (пальцем в слово не попасть), и содержимое идёт колонкой по центру —
 * на телефоне и на компьютере одинаково, компьютер просто шире.
 */

/** Высота 48 px — выше порога 44 px, который считается пригодным для пальца. */
export const ADMIN_BUTTON =
  "flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-accent px-4 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40";

export const ADMIN_BUTTON_SECONDARY =
  "flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-hairline bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-card-alt disabled:opacity-40";

export const ADMIN_BUTTON_DANGER =
  "flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-down/40 bg-transparent px-4 text-sm font-semibold text-down transition-colors hover:bg-down/10 disabled:opacity-40";

/** Колонка содержимого: по центру всегда, на большом экране просто шире. */
export const ADMIN_COLUMN = "mx-auto w-full max-w-[1100px] px-4 md:px-6";

/** Квадратная плитка со скруглением 22 px. */
export const ADMIN_TILE =
  "relative flex aspect-square flex-col justify-between overflow-hidden rounded-[22px] border border-hairline bg-card p-4";

/** Цвет точки срока. */
export const SLA_DOT: Record<"ok" | "warn" | "late" | "paused", string> = {
  ok: "bg-up",
  warn: "bg-[#e2a33c]",
  late: "bg-down",
  paused: "bg-muted",
};
