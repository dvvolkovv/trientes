/**
 * Карта личного кабинета: профиль в шапке, всё остальное — плитками.
 *
 * Карта одна и чистая: по ней рисуются плитки хаба, по ней же страница «Вид
 * разделов» строит палитру, и ею же сверяется полнота в тесте (у каждой плитки
 * есть подпись в переводах и своя страница на диске). Своя копия такого списка
 * в проекте уже однажды отставала — список локалей, уборка AU.
 *
 * Порядок — порядок пользовательского пути: сперва то, что настраивают (язык,
 * оповещения, интересы), потом то, что ведут (заявки, предприятия, карточки,
 * биржи), потом разговор и деньги, и в конце служебное.
 */

export type CabinetTileDef = {
  key: string;
  /** Путь внутри `/{locale}/cabinet/`. */
  path: string;
  /** Знак на плитке. Один символ: растр и svg чужого хоста тут не нужны. */
  icon: string;
  /** Полный путь строки в переводах — подпись плитки и заголовок раздела. */
  labelKey: string;
  /** Подпись помельче под названием. */
  hintKey?: string;
  /** Раздел считает свои записи: число на плитке. */
  counter?: CabinetCounter;
  /** Только сотруднику платформы. */
  staffOnly?: true;
  /** Ведёт наружу кабинета (админка) — тогда `path` это готовый адрес. */
  external?: true;
};

export type CabinetCounter =
  | "cases"
  | "companies"
  | "coins"
  | "exchanges"
  | "messages"
  | "subscriptions"
  | "alerts";

export const CABINET_TILES: CabinetTileDef[] = [
  {
    key: "settings",
    path: "settings",
    icon: "⚙️",
    labelKey: "cabinet.settings.title",
    hintKey: "cabinet.hub.hint.settings",
  },
  {
    key: "alerts",
    path: "alerts",
    icon: "🔔",
    labelKey: "cabinet.alerts.title",
    counter: "alerts",
  },
  {
    key: "interests",
    path: "interests",
    icon: "🧭",
    labelKey: "cabinetInterests.title",
    hintKey: "cabinet.hub.hint.interests",
  },
  { key: "cases", path: "cases", icon: "📨", labelKey: "cabinet.cases.title", counter: "cases" },
  {
    key: "companies",
    path: "companies",
    icon: "🏢",
    labelKey: "cabinet.companies.title",
    counter: "companies",
  },
  { key: "coins", path: "coins", icon: "🪙", labelKey: "cabinet.coins.title", counter: "coins" },
  {
    key: "exchanges",
    path: "exchanges",
    icon: "🏦",
    labelKey: "cabinet.exchanges.title",
    counter: "exchanges",
  },
  {
    key: "messages",
    path: "messages",
    icon: "✉️",
    labelKey: "customerMessages.myTitle",
    counter: "messages",
  },
  {
    key: "subscriptions",
    path: "subscriptions",
    icon: "📣",
    labelKey: "promos.subscriptions.title",
    counter: "subscriptions",
  },
  {
    key: "loyalty",
    path: "loyalty",
    icon: "🎁",
    labelKey: "loyalty.levels.title",
    hintKey: "cabinet.hub.hint.loyalty",
  },
  {
    key: "mfa",
    path: "mfa",
    icon: "🔐",
    labelKey: "cabinet.mfa.title",
    hintKey: "cabinet.hub.hint.mfa",
    staffOnly: true,
  },
  {
    key: "admin",
    path: "admin/queues",
    icon: "🛡️",
    labelKey: "cabinet.admin.title",
    hintKey: "cabinet.hub.hint.admin",
    staffOnly: true,
    external: true,
  },
  {
    key: "appearance",
    path: "appearance",
    icon: "🎨",
    labelKey: "cabinet.appearance.title",
    hintKey: "cabinet.hub.hint.appearance",
  },
];

/** Ключ цвета. Приставка обязательна: у админки свои `companies` и `coins`. */
export function cabinetColorKey(key: string): string {
  return `cab:${key}`;
}

export const CABINET_COLOR_KEYS = CABINET_TILES.map((t) => cabinetColorKey(t.key));

export function visibleCabinetTiles(isStaff: boolean): CabinetTileDef[] {
  return CABINET_TILES.filter((t) => !t.staffOnly || isStaff);
}

export function cabinetTileByPath(path: string): CabinetTileDef | null {
  return CABINET_TILES.find((t) => !t.external && t.path === path) ?? null;
}

/**
 * Старые якоря (`/cabinet#settings`) разбросаны по письмам и чужим закладкам.
 * Сервер хеша не видит — перевод делает браузер встроенным разбором на хабе.
 */
export const CABINET_HASH_ALIASES: Record<string, string> = {
  profile: "profile",
  settings: "settings",
  alerts: "alerts",
  cases: "cases",
  companies: "companies",
  coins: "coins",
  exchanges: "exchanges",
  loyalty: "loyalty",
  subscriptions: "subscriptions",
  interests: "interests",
  mfa: "mfa",
};
