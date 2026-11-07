// Разовая проверка доступности публичных API бирж с этой машины.
import { config } from "dotenv";
config({ path: ".env.local" });
import { ALL_CEX_IDS, fetchSnapshot } from "../src/lib/cex-snapshot";

async function main() {
  for (const id of ALL_CEX_IDS) {
    const t0 = Date.now();
    const snap = await fetchSnapshot(id);
    if ("error" in snap) console.log(`${id.padEnd(9)} ERROR ${snap.error} (${Date.now() - t0}ms)`);
    else console.log(`${id.padEnd(9)} ok ${String(snap.tickers.size).padStart(5)} пар (${Date.now() - t0}ms)`);
  }
}
void main();
