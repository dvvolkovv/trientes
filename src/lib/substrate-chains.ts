/**
 * Реестр Substrate-сетей, нативная единица которых может быть монетой
 * карточки. Реестр — код, а не пользовательский ввод: проект не подсовывает
 * свой RPC, иначе «проверено в блокчейне» означало бы «проверено на сервере,
 * который выбрал сам проект».
 *
 * Все три адреса проверены живым POST-запросом 7 ноября 2026.
 */

export type SubstrateChain = {
  key: string;
  label: string;
  defaultRpcUrl: string;
  /** Ожидаемый префикс SS58 и тикер: расхождение с узлом попадает в mismatches. */
  ss58Format: number;
  symbol: string;
};

export const SUBSTRATE_CHAINS: readonly SubstrateChain[] = [
  {
    key: "taler",
    label: "Taler",
    defaultRpcUrl: "https://node.taler.uno",
    ss58Format: 10960,
    symbol: "TAL",
  },
  {
    key: "polkadot",
    label: "Polkadot",
    defaultRpcUrl: "https://rpc.polkadot.io",
    ss58Format: 0,
    symbol: "DOT",
  },
  {
    key: "kusama",
    label: "Kusama",
    defaultRpcUrl: "https://kusama-rpc.polkadot.io",
    ss58Format: 2,
    symbol: "KSM",
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
