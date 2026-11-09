/**
 * Реестр Substrate-сетей, нативная единица которых может быть монетой
 * карточки. Реестр — код, а не пользовательский ввод: проект не подсовывает
 * свой RPC, иначе «проверено в блокчейне» означало бы «проверено на сервере,
 * который выбрал сам проект».
 *
 * Taler, Polkadot и Kusama проверены живым POST-запросом 7 ноября 2026,
 * остальные девять — 9 ноября (слайс V). Тогда же сняты индексы палеты
 * балансов и версии формата транзакций.
 */

export type SubstrateChain = {
  key: string;
  label: string;
  defaultRpcUrl: string;
  /**
   * Узел, с которого читается общий выпуск, если он не совпадает с основным.
   * Понадобился Polkadot и Kusama: балансы переехали в Asset Hub, и
   * `Balances.TotalIssuance` на релее отдаёт только остаток (245 862 DOT
   * против 1 711 256 874 на Asset Hub, замер 9 ноября 2026).
   */
  issuanceRpcUrl?: string;
  /**
   * Ожидаемый префикс SS58 и тикер: расхождение с узлом попадает в mismatches.
   * `null` — узел префикс не публикует и ждать от него нечего.
   */
  ss58Format: number | null;
  symbol: string;
  /**
   * Индекс палеты балансов (слайс T). В метаданных он есть, но добраться до
   * него — значит написать декодер реестра типов, поэтому индекс проверен
   * живым `payment_queryInfo` дважды: и `transfer_keep_alive` (вызов 3), и
   * `transfer_allow_death` (вызов 0) должны декодироваться и дать почти
   * одинаковую комиссию. `null` — комиссия у этой сети не читается, и это
   * честный `fee_unsupported`, а не индекс наугад.
   */
  balancesPallet: number | null;
  /**
   * Версия формата транзакций, при которой индекс проверен. Сеть бампает её
   * именно при смене формата экстринсика и индексов вызовов: разошлась —
   * комиссия становится неизвестной, а не показывается устаревшей.
   */
  transactionVersion: number | null;
};

export const SUBSTRATE_CHAINS: readonly SubstrateChain[] = [
  {
    key: "taler",
    label: "Taler",
    defaultRpcUrl: "https://node.taler.uno",
    ss58Format: 10960,
    symbol: "TAL",
    balancesPallet: 6,
    transactionVersion: 2,
  },
  {
    key: "polkadot",
    label: "Polkadot",
    defaultRpcUrl: "https://rpc.polkadot.io",
    issuanceRpcUrl: "https://polkadot-asset-hub-rpc.polkadot.io",
    ss58Format: 0,
    symbol: "DOT",
    balancesPallet: 5,
    transactionVersion: 26,
  },
  {
    key: "kusama",
    label: "Kusama",
    defaultRpcUrl: "https://kusama-rpc.polkadot.io",
    issuanceRpcUrl: "https://kusama-asset-hub-rpc.polkadot.io",
    ss58Format: 2,
    symbol: "KSM",
    balancesPallet: 4,
    transactionVersion: 26,
  },
  {
    key: "bittensor",
    label: "Bittensor",
    defaultRpcUrl: "https://entrypoint-finney.opentensor.ai",
    ss58Format: 42,
    symbol: "TAO",
    balancesPallet: 5,
    transactionVersion: 1,
  },
  {
    key: "astar",
    label: "Astar",
    defaultRpcUrl: "https://rpc.astar.network",
    ss58Format: 5,
    symbol: "ASTR",
    balancesPallet: 31,
    transactionVersion: 3,
  },
  {
    // Префикс 63 — из документации сети: `system_properties` его не публикует,
    // поэтому сверять с ответом узла нечего, а для проверки адресов исключений
    // значение нужно.
    key: "hydradx",
    label: "Hydration",
    defaultRpcUrl: "https://rpc.hydradx.cloud",
    ss58Format: 63,
    symbol: "HDX",
    // Набор подписанных расширений не совпал ни с одним из двух вариантов
    // слайса T: узел не декодирует экстринсик, и комиссия остаётся непрочитанной.
    balancesPallet: null,
    transactionVersion: null,
  },
  {
    key: "peaq",
    label: "peaq",
    defaultRpcUrl: "https://peaq.api.onfinality.io/public",
    ss58Format: 42,
    symbol: "PEAQ",
    balancesPallet: 4,
    transactionVersion: 2,
  },
  {
    key: "creditcoin",
    label: "Creditcoin",
    defaultRpcUrl: "https://mainnet3.creditcoin.network",
    ss58Format: 42,
    symbol: "CTC",
    balancesPallet: 3,
    transactionVersion: 4,
  },
  {
    key: "enjin",
    label: "Enjin Relaychain",
    defaultRpcUrl: "https://rpc.relay.blockchain.enjin.io",
    ss58Format: 2135,
    symbol: "ENJ",
    balancesPallet: 6,
    transactionVersion: 18,
  },
  {
    key: "polymesh",
    label: "Polymesh",
    defaultRpcUrl: "https://mainnet-rpc.polymesh.network",
    ss58Format: 12,
    symbol: "POLYX",
    balancesPallet: 5,
    transactionVersion: 8,
  },
  {
    // Moonbeam и Moonriver публикуют префикс под ключом `SS58Prefix`, которого
    // наш `readChainProperties` не знает, — сверка префикса просто не
    // срабатывает. Комиссия не читается по другой причине: адреса здесь
    // 20-байтные, `MultiAddress` в вызове перевода не применяется.
    key: "moonbeam",
    label: "Moonbeam",
    defaultRpcUrl: "https://moonbeam.api.onfinality.io/public",
    ss58Format: 1284,
    symbol: "GLMR",
    balancesPallet: null,
    transactionVersion: null,
  },
  {
    key: "moonriver",
    label: "Moonriver",
    defaultRpcUrl: "https://moonriver.api.onfinality.io/public",
    ss58Format: 1285,
    symbol: "MOVR",
    balancesPallet: null,
    transactionVersion: null,
  },
];

/** Значения select'а нативной сети в форме карточки. */
export const NATIVE_CHAIN_KEYS: readonly string[] = SUBSTRATE_CHAINS.map((c) => c.key);

export function resolveSubstrateChain(raw: string | null | undefined): SubstrateChain | null {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return null;
  return SUBSTRATE_CHAINS.find((c) => c.key === key) ?? null;
}

/**
 * Адрес узла: переопределение из окружения важнее реестра — публичный узел
 * может начать банить сервер, как это уже было со Stooq и Overpass.
 */
export function substrateRpcUrlFor(
  chain: SubstrateChain,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env[`SUBSTRATE_RPC_${chain.key.toUpperCase()}`];
  return override && override.trim().length > 0 ? override.trim() : chain.defaultRpcUrl;
}

/**
 * Адрес узла для чтения общего выпуска. У сети с переехавшими балансами он
 * свой, и подмена общего адреса его не трогает: иначе администратор, указавший
 * свой релейный узел, незаметно вернул бы заниженный выпуск.
 */
export function substrateIssuanceUrlFor(
  chain: SubstrateChain,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env[`SUBSTRATE_ISSUANCE_RPC_${chain.key.toUpperCase()}`];
  if (override && override.trim().length > 0) return override.trim();
  if (chain.issuanceRpcUrl) return chain.issuanceRpcUrl;
  return substrateRpcUrlFor(chain, env);
}
