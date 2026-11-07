/**
 * Реестр Substrate-сетей, нативная единица которых может быть монетой
 * карточки. Реестр — код, а не пользовательский ввод: проект не подсовывает
 * свой RPC, иначе «проверено в блокчейне» означало бы «проверено на сервере,
 * который выбрал сам проект».
 *
 * Все три адреса проверены живым POST-запросом 7 ноября 2026; тогда же сняты
 * индексы палеты балансов и версии формата транзакций (слайс T).
 */

export type SubstrateChain = {
  key: string;
  label: string;
  defaultRpcUrl: string;
  /** Ожидаемый префикс SS58 и тикер: расхождение с узлом попадает в mismatches. */
  ss58Format: number;
  symbol: string;
  /**
   * Индекс палеты балансов в рантайме (слайс T). В метаданных он есть, но
   * добраться до него — значит написать декодер реестра типов, поэтому индекс
   * проверен живым `payment_queryInfo` и пришпилен здесь.
   */
  balancesPallet: number;
  /**
   * Версия формата транзакций, при которой индекс проверен. Сеть бампает её
   * именно при смене формата экстринсика и индексов вызовов: разошлась —
   * комиссия становится неизвестной, а не показывается устаревшей.
   */
  transactionVersion: number;
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
    ss58Format: 0,
    symbol: "DOT",
    balancesPallet: 5,
    transactionVersion: 26,
  },
  {
    key: "kusama",
    label: "Kusama",
    defaultRpcUrl: "https://kusama-rpc.polkadot.io",
    ss58Format: 2,
    symbol: "KSM",
    balancesPallet: 4,
    transactionVersion: 26,
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
