/**
 * Реестр EVM-сетей. Служит двум слайсам сразу, и это сознательно один реестр, а
 * не два:
 *
 * - слайс B сверяет по нему **контракты токенов** (`chain` у карточки — свободная
 *   строка, которую вводит проект, поэтому нормализуем по алиасам, а не ждём
 *   точного совпадения; сеть, которой здесь нет, честно считается непрочитанной);
 * - слайс Z читает по нему **нативную монету сети** — для этого у сети
 *   закреплены `chainId`, хэш генезиса, тикер, знаки и газ эталонного перевода.
 *
 * Два реестра для одних и тех же адресов неизбежно разошлись бы.
 *
 * Все `chainId` и хэши генезиса сняты живым запросом 9 ноября 2026.
 */

export type EvmChain = {
  key: string;
  label: string;
  defaultRpcUrl: string;
  /**
   * Идентичность сети: закреплён консенсусом (входит в подпись транзакции как
   * защита от повтора) и у живой сети не меняется. Несовпадение с ответом узла
   * означает подмену адреса, а не переезд сети.
   */
  chainId: number;
  /**
   * Хэш блока 0, если узел его отдаёт. Cronos и Hyperliquid не отдают
   * (обрезанная база), и это не сбой: идентичность доказана `chainId`.
   */
  genesisHash?: string;
  /** Ожидаемый тикер нативной монеты. Из `eth_*` его не прочитать. */
  symbol: string;
  /** Знаков в нативной монете. Во всей семье 18, но числом, а не допущением. */
  decimals: number;
  /**
   * Газ перевода без данных — 21 000. Это константа протокола, а не наш выбор
   * размера, как в семье Bitcoin.
   */
  transferGas: number;
};

/** Газ перевода без данных: записан в самом протоколе EVM. */
export const TRANSFER_GAS = 21_000;

/** Публичные RPC без ключей и регистрации. */
export const EVM_CHAINS: readonly EvmChain[] = [
  {
    key: "ethereum",
    label: "Ethereum",
    defaultRpcUrl: "https://ethereum-rpc.publicnode.com",
    chainId: 1,
    genesisHash: "0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3",
    symbol: "ETH",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
  {
    key: "bsc",
    label: "BNB Chain",
    // `bsc-rpc.publicnode.com` повторяемо отдаёт нашему серверу 403.
    defaultRpcUrl: "https://bsc-dataseed.bnbchain.org",
    chainId: 56,
    genesisHash: "0x0d21840abff46b96c84b2ac9e10e4f5cdaeb5693cb665db62a2f3b02d2d57b5b",
    symbol: "BNB",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
  {
    key: "polygon",
    label: "Polygon",
    defaultRpcUrl: "https://polygon-bor-rpc.publicnode.com",
    chainId: 137,
    genesisHash: "0xa9c28ce2141b56c474f1dc504bee9b01eb1bd7d1a507580d5519d4437a97de1b",
    symbol: "POL",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
  {
    key: "arbitrum",
    label: "Arbitrum One",
    defaultRpcUrl: "https://arbitrum-one-rpc.publicnode.com",
    chainId: 42161,
    genesisHash: "0x7ee576b35482195fc49205cec9af72ce14f003b9ae69f6ba0faef4514be8b442",
    // Нативная монета L2 — тот же ETH, и карточка ETH привязана к Ethereum:
    // в таблице посева этой сети нет.
    symbol: "ETH",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
  {
    key: "optimism",
    label: "Optimism",
    defaultRpcUrl: "https://optimism-rpc.publicnode.com",
    chainId: 10,
    genesisHash: "0x7ca38a1916c42007829c55e69d3e9a73265554b586a499015373241b8a3fa48b",
    symbol: "ETH",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
  {
    key: "base",
    label: "Base",
    defaultRpcUrl: "https://base-rpc.publicnode.com",
    chainId: 8453,
    symbol: "ETH",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
  {
    key: "avalanche",
    label: "Avalanche C-Chain",
    defaultRpcUrl: "https://avalanche-c-chain-rpc.publicnode.com",
    chainId: 43114,
    genesisHash: "0x31ced5b9beb7f8782b014660da0cb18cc409f121f408186886e1ca3e8eeca96b",
    symbol: "AVAX",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
  // Слайс Z: сети, нативная монета которых есть в каталоге.
  {
    key: "cronos",
    label: "Cronos",
    defaultRpcUrl: "https://cronos-evm-rpc.publicnode.com",
    chainId: 25,
    symbol: "CRO",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
  {
    key: "sonic",
    label: "Sonic",
    defaultRpcUrl: "https://sonic-rpc.publicnode.com",
    chainId: 146,
    genesisHash: "0x411c75a1b1c2f2f458bcf243e7743d114e0117a4233cc13d91e7efc8fe8b0f3b",
    symbol: "S",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
  {
    key: "berachain",
    label: "Berachain",
    defaultRpcUrl: "https://berachain-rpc.publicnode.com",
    chainId: 80094,
    genesisHash: "0xd57819422128da1c44339fc7956662378c17e2213e669b427ac91cd11dfcfb38",
    symbol: "BERA",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
  {
    key: "sei",
    label: "Sei",
    defaultRpcUrl: "https://sei-evm-rpc.publicnode.com",
    // Узел отдаёт хэш заглавными буквами — сравнение без учёта регистра.
    genesisHash: "0xf9d3845df25b43b1c6926f3ceda6845c17f5624e12212fd8847d0ba01da1ab9e",
    chainId: 1329,
    symbol: "SEI",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
  {
    key: "hyperliquid",
    label: "Hyperliquid",
    defaultRpcUrl: "https://rpc.hyperliquid.xyz/evm",
    chainId: 999,
    symbol: "HYPE",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
  {
    key: "mantle",
    label: "Mantle",
    defaultRpcUrl: "https://mantle-rpc.publicnode.com",
    chainId: 5000,
    genesisHash: "0x0a0eb32c4b024b28da5bf83356f7987c1b0612bbfbc9156186c59c834bfcd013",
    symbol: "MNT",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
  {
    key: "celo",
    label: "Celo",
    defaultRpcUrl: "https://celo-rpc.publicnode.com",
    chainId: 42220,
    genesisHash: "0x19ea3339d3c8cda97235bc8293240d5b9dadcdfbb5d4b0b90ee731cac1bd11c3",
    symbol: "CELO",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
  {
    key: "flare",
    label: "Flare",
    defaultRpcUrl: "https://flare-api.flare.network/ext/C/rpc",
    chainId: 14,
    genesisHash: "0xf501834f1cfce08939acb0feadb11ca0a94d806c5bedb6700a771fc27d2f1068",
    symbol: "FLR",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
  {
    key: "ronin",
    label: "Ronin",
    defaultRpcUrl: "https://api.roninchain.com/rpc",
    chainId: 2020,
    genesisHash: "0x456ac0552c86e356a3f7517d8cde08f3a56309f18c77512760024ff8244af978",
    symbol: "RON",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
  {
    key: "kaia",
    label: "Kaia",
    defaultRpcUrl: "https://public-en.node.kaia.io",
    chainId: 8217,
    genesisHash: "0xc72e5293c3c3ba38ed8ae910f780e4caaa9fb95e79784f7ab74c3c262ea7137e",
    symbol: "KAIA",
    decimals: 18,
    transferGas: TRANSFER_GAS,
  },
];

const ALIASES: Record<string, string> = {
  ethereum: "ethereum", eth: "ethereum", erc20: "ethereum", mainnet: "ethereum",
  ethereummainnet: "ethereum", ether: "ethereum",
  bsc: "bsc", bnb: "bsc", bnbchain: "bsc", binance: "bsc",
  binancesmartchain: "bsc", bep20: "bsc",
  polygon: "polygon", matic: "polygon", polygonpos: "polygon", pol: "polygon",
  arbitrum: "arbitrum", arbitrumone: "arbitrum", arb: "arbitrum",
  optimism: "optimism", op: "optimism", opmainnet: "optimism",
  base: "base", basemainnet: "base",
  avalanche: "avalanche", avax: "avalanche",
  avalanchecchain: "avalanche", avaxcchain: "avalanche",
  cronos: "cronos", cro: "cronos", cronoschain: "cronos",
  sonic: "sonic", sonicmainnet: "sonic",
  berachain: "berachain", bera: "berachain",
  sei: "sei", seinetwork: "sei", seievm: "sei",
  hyperliquid: "hyperliquid", hyperevm: "hyperliquid", hype: "hyperliquid",
  mantle: "mantle", mnt: "mantle",
  celo: "celo",
  flare: "flare", flarenetwork: "flare", flr: "flare",
  ronin: "ronin", ron: "ronin", roninchain: "ronin",
  kaia: "kaia", klaytn: "kaia", klay: "kaia",
};

function canonical(raw: string): string {
  return (raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function resolveEvmChain(raw: string | null | undefined): EvmChain | null {
  const key = ALIASES[canonical(raw ?? "")];
  if (!key) return null;
  return EVM_CHAINS.find((c) => c.key === key) ?? null;
}

/**
 * Адрес RPC: переопределение из окружения важнее реестра — публичный узел
 * может начать банить сервер, как это уже было со Stooq и Overpass.
 */
export function rpcUrlFor(
  chain: EvmChain,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env[`EVM_RPC_${chain.key.toUpperCase()}`];
  return override && override.trim().length > 0 ? override.trim() : chain.defaultRpcUrl;
}
