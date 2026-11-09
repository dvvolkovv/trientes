/**
 * Таблица посева карточек, проверяемых в сети (слайс V).
 *
 * Почему это код, а не данные: привязка карточки к сети высокорисковая (слайс
 * S) — подмена ключа переносит на карточку выпуск и скорость чужой сети. Такое
 * значение не приходит из формы и не правится в базе мимо ревизии.
 *
 * В посеянную карточку кладётся только имя, тикер и ключ сети. Описание,
 * ссылки и биржи не переливаются: они уже стоят выше на той же странице монеты,
 * и карточка добавляет то, чего там нет, — факты, прочитанные из сети.
 */

import { resolveCosmosChain } from "./cosmos-chains";
import { resolveSubstrateChain } from "./substrate-chains";

export type ChainFamily = "SUBSTRATE" | "COSMOS";

export type SeedRow = {
  /** `Coin.id` в нашей базе: карточка становится слоем поверх его страницы. */
  coinId: string;
  /** Ключ сети из одного из двух реестров. */
  chain: string;
};

export const SEED_CARDS: readonly SeedRow[] = [
  // Substrate: читается тем же кодом, что карточка Taler (слайсы S и T).
  // Polkadot и Kusama в каталоге CoinGecko не лежат в категории layer-1, из-за
  // чего их не принёс автосинк и в первом прогоне посева их не было; монеты
  // добавлены как ADMIN_ADDED, выпуск читается с Asset Hub (см. реестр).
  { coinId: "polkadot", chain: "polkadot" },
  { coinId: "kusama", chain: "kusama" },
  { coinId: "bittensor", chain: "bittensor" },
  { coinId: "astar", chain: "astar" },
  { coinId: "hydradx", chain: "hydradx" },
  { coinId: "peaq-2", chain: "peaq" },
  { coinId: "creditcoin-2", chain: "creditcoin" },
  { coinId: "enjincoin", chain: "enjin" },
  { coinId: "polymesh", chain: "polymesh" },
  { coinId: "moonbeam", chain: "moonbeam" },
  { coinId: "moonriver", chain: "moonriver" },
  // Cosmos SDK: стандартный REST, свой ридер.
  { coinId: "celestia", chain: "celestia" },
  { coinId: "injective-protocol", chain: "injective" },
  { coinId: "dydx-chain", chain: "dydx" },
  { coinId: "kava", chain: "kava" },
  { coinId: "atomone", chain: "atomone" },
  { coinId: "hash-2", chain: "provenance" },
  { coinId: "initia", chain: "initia" },
  { coinId: "saga-2", chain: "saga" },
  { coinId: "secret", chain: "secret" },
];

/** К какой семье относится ключ сети. Ключи реестров не пересекаются. */
export function chainFamily(chain: string): ChainFamily | null {
  if (resolveSubstrateChain(chain)) return "SUBSTRATE";
  if (resolveCosmosChain(chain)) return "COSMOS";
  return null;
}

export type SeedCoin = {
  id: string;
  slug: string;
  name: string;
  symbol: string;
};

export type PlannedCard = {
  slug: string;
  coinId: string;
  name: string;
  symbol: string;
  nativeChain: string;
  status: "PENDING";
  trust: "UNVERIFIED";
  provenance: Record<string, { kind: "ADMIN_SET"; source: string; at: string }>;
};

/**
 * Что именно создаётся на монету. Чистая функция, чтобы состав посеянной
 * карточки проверялся тестом, а не глазами по логу скрипта.
 *
 * `status: PENDING` — карточка не публична, пока её не посмотрели: публичный
 * запрос требует `APPROVED`. Ни куратора, ни компании у неё нет — никто не
 * выдаёт себя за владельца монеты, и плашка говорит об этом прямо.
 */
export function plannedCard(coin: SeedCoin, chain: string, at: Date): PlannedCard {
  if (!chainFamily(chain)) throw new Error(`unknown_chain:${chain}`);
  return {
    slug: coin.slug,
    coinId: coin.id,
    name: coin.name,
    symbol: coin.symbol.toUpperCase(),
    nativeChain: chain,
    status: "PENDING",
    trust: "UNVERIFIED",
    // Раздел контрактов заполнен нами, а не проектом: ключ сети выбрал
    // администратор, а числа в него принесут прогоны с кодом VERIFIED_ONCHAIN.
    provenance: {
      contracts: { kind: "ADMIN_SET", source: "seed", at: at.toISOString() },
    },
  };
}
