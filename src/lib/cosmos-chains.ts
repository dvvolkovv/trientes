/**
 * Реестр сетей на Cosmos SDK, нативная единица которых может быть монетой
 * карточки. Правило то же, что у Substrate (слайс S): реестр — код, а не
 * пользовательский ввод, иначе «проверено в сети» означало бы «проверено на
 * сервере, который выбрал сам проект».
 *
 * Все двадцать адресов и chain-id проверены живым GET-запросом 9 ноября 2026.
 * Деном и порядок — из ответа `bank/supply/by_denom` и публичной документации
 * сети; расхождение ожидаемого chain-id с ответом узла попадает в mismatches.
 */

export type CosmosChain = {
  key: string;
  label: string;
  defaultRestUrl: string;
  /** Ожидаемый chain-id: для Cosmos это и есть идентичность сети. */
  chainId: string;
  /** Базовый деном, в котором узел считает выпуск: utia, adydx, nhash. */
  denom: string;
  /** Сколько знаков в монете: utia → TIA это 10⁶. */
  exponent: number;
  /** Ожидаемый тикер. У Cosmos его неоткуда прочитать: в RPC тикера нет. */
  symbol: string;
  /**
   * Префикс bech32 адресов сети. Сейчас не используется: понадобится, когда
   * комиссию перевода начнёт считать узел через `tx/simulate` — там нужны
   * адреса отправителя и получателя.
   */
  bech32Prefix: string;
};

export const COSMOS_CHAINS: readonly CosmosChain[] = [
  // Слайс W, проверено живым GET 9 ноября 2026.
  {
    // Ключ `cosmoshub`, а не `cosmos`: родовое слово семьи сетью не считается
    // (его отбивает `resolveCosmosChain`), иначе карточка могла бы привязаться
    // к «семье вообще» вместо конкретной сети.
    key: "cosmoshub",
    label: "Cosmos Hub",
    defaultRestUrl: "https://cosmos-rest.publicnode.com",
    chainId: "cosmoshub-4",
    denom: "uatom",
    exponent: 6,
    symbol: "ATOM",
    bech32Prefix: "cosmos",
  },
  {
    key: "osmosis",
    label: "Osmosis",
    defaultRestUrl: "https://osmosis-rest.publicnode.com",
    chainId: "osmosis-1",
    denom: "uosmo",
    exponent: 6,
    symbol: "OSMO",
    bech32Prefix: "osmo",
  },
  {
    key: "akash",
    label: "Akash Network",
    defaultRestUrl: "https://akash-rest.publicnode.com",
    chainId: "akashnet-2",
    denom: "uakt",
    exponent: 6,
    symbol: "AKT",
    bech32Prefix: "akash",
  },
  {
    key: "juno",
    label: "Juno",
    defaultRestUrl: "https://juno-rest.publicnode.com",
    chainId: "juno-1",
    denom: "ujuno",
    exponent: 6,
    symbol: "JUNO",
    bech32Prefix: "juno",
  },
  {
    key: "axelar",
    label: "Axelar",
    defaultRestUrl: "https://axelar-rest.publicnode.com",
    chainId: "axelar-dojo-1",
    denom: "uaxl",
    exponent: 6,
    symbol: "AXL",
    bech32Prefix: "axelar",
  },
  {
    key: "neutron",
    label: "Neutron",
    defaultRestUrl: "https://neutron-api.polkachu.com",
    chainId: "neutron-1",
    denom: "untrn",
    exponent: 6,
    symbol: "NTRN",
    bech32Prefix: "neutron",
  },
  {
    key: "stride",
    label: "Stride",
    defaultRestUrl: "https://stride-api.polkachu.com",
    chainId: "stride-1",
    denom: "ustrd",
    exponent: 6,
    symbol: "STRD",
    bech32Prefix: "stride",
  },
  {
    key: "dymension",
    label: "Dymension",
    defaultRestUrl: "https://dymension-api.polkachu.com",
    chainId: "dymension_1100-1",
    denom: "adym",
    exponent: 18,
    symbol: "DYM",
    bech32Prefix: "dym",
  },
  {
    key: "persistence",
    label: "Persistence",
    defaultRestUrl: "https://persistence-api.polkachu.com",
    chainId: "core-1",
    denom: "uxprt",
    exponent: 6,
    symbol: "XPRT",
    bech32Prefix: "persistence",
  },
  {
    key: "agoric",
    label: "Agoric",
    defaultRestUrl: "https://agoric-api.polkachu.com",
    chainId: "agoric-3",
    denom: "ubld",
    exponent: 6,
    symbol: "BLD",
    bech32Prefix: "agoric",
  },
  {
    key: "band",
    label: "Band Protocol",
    defaultRestUrl: "https://band-api.polkachu.com",
    chainId: "laozi-mainnet",
    denom: "uband",
    exponent: 6,
    symbol: "BAND",
    bech32Prefix: "band",
  },
  {
    key: "celestia",
    label: "Celestia",
    defaultRestUrl: "https://celestia-rest.publicnode.com",
    chainId: "celestia",
    denom: "utia",
    exponent: 6,
    symbol: "TIA",
    bech32Prefix: "celestia",
  },
  {
    key: "injective",
    label: "Injective",
    defaultRestUrl: "https://injective-rest.publicnode.com",
    chainId: "injective-1",
    denom: "inj",
    exponent: 18,
    symbol: "INJ",
    bech32Prefix: "inj",
  },
  {
    key: "dydx",
    label: "dYdX Chain",
    defaultRestUrl: "https://dydx-rest.publicnode.com",
    chainId: "dydx-mainnet-1",
    denom: "adydx",
    exponent: 18,
    symbol: "DYDX",
    bech32Prefix: "dydx",
  },
  {
    key: "kava",
    label: "Kava",
    defaultRestUrl: "https://api.data.kava.io",
    chainId: "kava_2222-10",
    denom: "ukava",
    exponent: 6,
    symbol: "KAVA",
    bech32Prefix: "kava",
  },
  {
    key: "atomone",
    label: "AtomOne",
    defaultRestUrl: "https://atomone-rest.publicnode.com",
    chainId: "atomone-1",
    denom: "uatone",
    exponent: 6,
    symbol: "ATONE",
    bech32Prefix: "atone",
  },
  {
    key: "provenance",
    label: "Provenance",
    defaultRestUrl: "https://api.provenance.io",
    chainId: "pio-mainnet-1",
    denom: "nhash",
    exponent: 9,
    symbol: "HASH",
    bech32Prefix: "pb",
  },
  {
    key: "initia",
    label: "Initia",
    defaultRestUrl: "https://rest.initia.xyz",
    chainId: "interwoven-1",
    denom: "uinit",
    exponent: 6,
    symbol: "INIT",
    bech32Prefix: "init",
  },
  {
    key: "saga",
    label: "Saga",
    defaultRestUrl: "https://saga-rest.publicnode.com",
    chainId: "ssc-1",
    denom: "usaga",
    exponent: 6,
    symbol: "SAGA",
    bech32Prefix: "saga",
  },
  {
    key: "secret",
    label: "Secret Network",
    defaultRestUrl: "https://rest.lavenderfive.com/secretnetwork",
    chainId: "secret-4",
    denom: "uscrt",
    exponent: 6,
    symbol: "SCRT",
    bech32Prefix: "secret",
  },
];

export const COSMOS_CHAIN_KEYS: readonly string[] = COSMOS_CHAINS.map((c) => c.key);

export function resolveCosmosChain(raw: string | null | undefined): CosmosChain | null {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return null;
  return COSMOS_CHAINS.find((c) => c.key === key) ?? null;
}

/**
 * Адрес REST-узла: переопределение из окружения важнее реестра — публичный
 * узел может начать банить сервер, как это уже было со Stooq и Overpass.
 */
export function cosmosRestUrlFor(
  chain: CosmosChain,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env[`COSMOS_REST_${chain.key.toUpperCase()}`];
  const raw = override && override.trim().length > 0 ? override.trim() : chain.defaultRestUrl;
  // Адрес склеивается с путём запроса, и лишний слэш на конце превращал бы его
  // в «//cosmos/...», что часть узлов отдаёт как 404.
  return raw.replace(/\/+$/, "");
}
