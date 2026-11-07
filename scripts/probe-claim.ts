// Разовая живая проверка слайса D: доступен ли DNS-over-HTTPS с этой машины,
// читается ли owner() у настоящего контракта, как ведёт себя .well-known.
import { config } from "dotenv";
config({ path: ".env.local" });
import { fetchTxtRecords, fetchWellKnown } from "../src/lib/claim-domain";
import { readContractOwner } from "../src/lib/coin-card-claim";

async function main() {
  const txt = await fetchTxtRecords("trientes.org");
  console.log("DNS TXT trientes.org:", txt.error ?? txt.records);

  const google = await fetchTxtRecords("google.com");
  console.log("DNS TXT google.com:", google.error ?? `${google.records.length} записей`);

  const wk = await fetchWellKnown("trientes.org");
  console.log("well-known trientes.org:", wk.error ?? JSON.stringify(wk.body?.slice(0, 60)));

  // USDT: контракт с настоящим owner().
  const usdt = await readContractOwner({ chain: "ethereum", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" });
  console.log("owner() USDT:", usdt.error ?? usdt.owner);

  // USDC: прокси без публичного owner() на этом адресе.
  const weth = await readContractOwner({ chain: "ethereum", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" });
  console.log("owner() WETH:", weth.error ?? weth.owner);
}
void main();
