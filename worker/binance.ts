import WebSocket from "ws";
import { redis } from "../src/lib/redis";
import {
  CG_TO_BINANCE,
  BINANCE_TO_CG,
  parseMiniTicker,
} from "../src/lib/live/binance-mapping";
import { LIVE, LIVE_TTL } from "../src/lib/live/keys";

const PAIRS = Object.values(CG_TO_BINANCE).map((p) => p.toLowerCase());
const STREAM_URL = `wss://stream.binance.com:9443/stream?streams=${PAIRS.map((p) => `${p}@miniTicker`).join("/")}`;

let ws: WebSocket | null = null;
let reconnectAttempt = 0;

function backoffMs(): number {
  const base = Math.min(30_000, 1000 * 2 ** reconnectAttempt);
  return base + Math.floor(Math.random() * 1000);
}

async function handleTicker(raw: unknown) {
  const parsed = parseMiniTicker(raw);
  if (!parsed) return;
  const coinId = BINANCE_TO_CG[parsed.binancePair];
  if (!coinId) return;
  const value = JSON.stringify({ coinId, price: parsed.price, ts: Date.now() });
  try {
    await Promise.all([
      redis.set(LIVE.price(coinId), value, "EX", LIVE_TTL.price),
      redis.publish(LIVE.channel, value),
    ]);
  } catch (err) {
    // Tolerate transient Redis hiccups.
    console.error("[binance] redis write failed:", err);
  }
}

export function startBinance() {
  console.log(`[binance] connecting to ${PAIRS.length} streams…`);
  ws = new WebSocket(STREAM_URL);

  ws.on("open", () => {
    console.log("[binance] connected");
    reconnectAttempt = 0;
  });

  ws.on("message", (data: WebSocket.Data) => {
    try {
      const payload = JSON.parse(data.toString());
      // Combined stream wraps in { stream, data }
      const tickerData = payload.data ?? payload;
      void handleTicker(tickerData);
    } catch (err) {
      console.error("[binance] parse error:", err);
    }
  });

  ws.on("close", () => {
    const wait = backoffMs();
    reconnectAttempt++;
    console.warn(`[binance] disconnected, reconnecting in ${wait}ms (attempt ${reconnectAttempt})`);
    setTimeout(startBinance, wait);
  });

  ws.on("error", (err) => {
    console.error("[binance] socket error:", err.message);
    // 'close' will fire next and trigger reconnect.
  });
}

export function stopBinance() {
  if (ws) {
    ws.removeAllListeners("close"); // prevent reconnect on intentional close
    ws.close();
    ws = null;
  }
}
