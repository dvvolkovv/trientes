/**
 * Реестр EVM-сетей для сверки контрактов. Поле chain у карточки — свободная
 * строка, которую вводит проект, поэтому нормализуем по алиасам, а не ждём
 * точного совпадения. Сеть, которой здесь нет, честно считается непрочитанной.
 */

export type EvmChain = {
  key: string;
  label: string;
  defaultRpcUrl: string;
};

/** Публичные RPC без ключей и регистрации (publicnode). */
export const EVM_CHAINS: readonly EvmChain[] = [
  { key: "ethereum", label: "Ethereum", defaultRpcUrl: "https://ethereum-rpc.publicnode.com" },
  { key: "bsc", label: "BNB Chain", defaultRpcUrl: "https://bsc-rpc.publicnode.com" },
  { key: "polygon", label: "Polygon", defaultRpcUrl: "https://polygon-bor-rpc.publicnode.com" },
  { key: "arbitrum", label: "Arbitrum One", defaultRpcUrl: "https://arbitrum-one-rpc.publicnode.com" },
  { key: "optimism", label: "Optimism", defaultRpcUrl: "https://optimism-rpc.publicnode.com" },
  { key: "base", label: "Base", defaultRpcUrl: "https://base-rpc.publicnode.com" },
  {
    key: "avalanche",
    label: "Avalanche C-Chain",
    defaultRpcUrl: "https://avalanche-c-chain-rpc.publicnode.com",
  },
];

const ALIASES: Record<string, string> = {
  ethereum: "ethereum", eth: "ethereum", erc20: "ethereum", mainnet: "ethereum",
  ethereummainnet: "ethereum", ether: "ethereum",
  bsc: "bsc", bnb: "bsc", bnbchain: "bsc", binance: "bsc",
  binancesmartchain: "bsc", bep20: "bsc",
  polygon: "polygon", matic: "polygon", polygonpos: "polygon",
  arbitrum: "arbitrum", arbitrumone: "arbitrum", arb: "arbitrum",
  optimism: "optimism", op: "optimism", opmainnet: "optimism",
  base: "base", basemainnet: "base",
  avalanche: "avalanche", avax: "avalanche",
  avalanchecchain: "avalanche", avaxcchain: "avalanche",
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
