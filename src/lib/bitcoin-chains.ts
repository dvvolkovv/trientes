/**
 * Реестр цепей семьи Bitcoin (слайс Y), нативная единица которых может быть
 * монетой карточки. Правило то же, что у Substrate (слайс S) и Cosmos (слайс
 * V): реестр — код, а не пользовательский ввод, иначе «проверено в сети»
 * означало бы «проверено на сервере, который выбрал сам проект».
 *
 * Все адреса, хэши и числа проверены живыми запросами 9 ноября 2026.
 *
 * Чем эта семья отличается от двух прежних: хэш генезиса здесь **не уникален**.
 * Bitcoin Cash, Bitcoin SV и Bitcoin Gold — форки Bitcoin, блок 0 у них тот же,
 * поэтому подменённый на форк узел прошёл бы проверку идентичности. Для цепи с
 * форками в реестре лежит ещё и контрольный блок выше точки форка.
 */

/** Форма API узла. Набор фактов у обеих одинаков, различается только запрос. */
export type BitcoinApi = "ESPLORA" | "BLOCKCYPHER";

export type BitcoinChain = {
  key: string;
  label: string;
  api: BitcoinApi;
  defaultApiUrl: string;
  /** Ожидаемый хэш блока 0. Идентичность цепи, но для форков недостаточная. */
  genesisHash: string;
  /**
   * Блок выше точки форка: единственное, что отличает Bitcoin от Bitcoin Cash,
   * Bitcoin SV и Bitcoin Gold — генезис у них общий. Задан только там, где
   * форки есть.
   */
  checkpoint?: { height: number; hash: string };
  /** Ожидаемый тикер. Из этих API его не прочитать — сверять нечем. */
  symbol: string;
  /** Знаков в монете: во всей семье 10⁸ (сатоши), но числом, а не допущением. */
  decimals: number;
  /**
   * Размер эталонного перевода в vB: один вход, два выхода. 141 — P2WPKH
   * (segwit), 226 — P2PKH (legacy). Узел оценивает цену за байт, а размер
   * задаём мы — это и делает комиссию моделью, о чём подпись в карточке
   * говорит прямо.
   */
  txVsize: number;
  /** На сколько блоков вперёд просим оценку комиссии. */
  feeTargetBlocks: number;
};

export const BITCOIN_CHAINS: readonly BitcoinChain[] = [
  {
    key: "bitcoin",
    label: "Bitcoin",
    api: "ESPLORA",
    defaultApiUrl: "https://mempool.space/api",
    genesisHash: "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
    // Форк Bitcoin Cash отделился на блоке 478 558; 800 000 заведомо выше и
    // есть только в этой цепи.
    checkpoint: {
      height: 800_000,
      hash: "00000000000000000002a7c4c1e48d76c5a37902165a270156b7a8d72728a054",
    },
    symbol: "BTC",
    decimals: 8,
    txVsize: 141,
    feeTargetBlocks: 6,
  },
  {
    key: "litecoin",
    label: "Litecoin",
    api: "ESPLORA",
    defaultApiUrl: "https://litecoinspace.org/api",
    genesisHash: "12a765e31ffd4059bada1e25190f6e98c99d9714d334efa41a195a7e7e04bfe2",
    symbol: "LTC",
    decimals: 8,
    txVsize: 141,
    feeTargetBlocks: 6,
  },
  {
    key: "digibyte",
    label: "DigiByte",
    api: "ESPLORA",
    defaultApiUrl: "https://digiexplorer.info/api",
    genesisHash: "7497ea1b465eb39f1c8f507bc877078fe016d6fcb6dfad3a64c98dcc6e1e8496",
    symbol: "DGB",
    decimals: 8,
    txVsize: 141,
    feeTargetBlocks: 6,
  },
  {
    key: "dogecoin",
    label: "Dogecoin",
    api: "BLOCKCYPHER",
    defaultApiUrl: "https://api.blockcypher.com/v1/doge/main",
    genesisHash: "1a91e3dace36e2be3bf030a65679fe821aa1d6ef92e7c9902eb318182c355691",
    symbol: "DOGE",
    decimals: 8,
    // Segwit в Dogecoin нет: эталон — legacy-перевод.
    txVsize: 226,
    feeTargetBlocks: 6,
  },
  {
    key: "dash",
    label: "Dash",
    api: "BLOCKCYPHER",
    defaultApiUrl: "https://api.blockcypher.com/v1/dash/main",
    genesisHash: "00000ffd590b1485b3caadc19b22e6379c733355108f107a430458cdf3407ab6",
    symbol: "DASH",
    decimals: 8,
    txVsize: 226,
    feeTargetBlocks: 6,
  },
];

export const BITCOIN_CHAIN_KEYS: readonly string[] = BITCOIN_CHAINS.map((c) => c.key);

export function resolveBitcoinChain(raw: string | null | undefined): BitcoinChain | null {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return null;
  return BITCOIN_CHAINS.find((c) => c.key === key) ?? null;
}

/**
 * Адрес узла: переопределение из окружения важнее реестра — публичный адрес
 * рано или поздно начинает банить сервер (так было со Stooq и Overpass).
 */
export function bitcoinApiUrlFor(
  chain: BitcoinChain,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env[`BITCOIN_API_${chain.key.toUpperCase()}`];
  const raw = override && override.trim().length > 0 ? override.trim() : chain.defaultApiUrl;
  // Адрес склеивается с путём запроса, и лишний слэш превратил бы его в
  // «//blocks/tip/height», что часть узлов отдаёт как 404.
  return raw.replace(/\/+$/, "");
}
