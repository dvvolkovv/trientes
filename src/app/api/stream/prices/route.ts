import Redis from "ioredis";
import { LIVE } from "@/lib/live/keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  // Use a dedicated Redis subscriber (ioredis requires a separate connection
  // when in subscribe mode — can't share the main `redis` singleton).
  const sub = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  const main = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // controller already closed; ignore
        }
      };

      // 1) Initial dump from cache so the client has prices immediately.
      try {
        const keys = await main.keys("live:price:*");
        if (keys.length > 0) {
          const values = await main.mget(...keys);
          for (const v of values) {
            if (v) {
              try {
                send("price", JSON.parse(v));
              } catch {
                /* skip malformed */
              }
            }
          }
        }
      } catch (err) {
        send("error", { message: String(err) });
      }

      // 2) Subscribe to live updates.
      sub.subscribe(LIVE.channel, (err) => {
        if (err) send("error", { message: String(err) });
      });
      sub.on("message", (_chan, message) => {
        try {
          send("price", JSON.parse(message));
        } catch {
          /* skip */
        }
      });

      // 3) Heartbeat every 25s to keep proxies from idling the connection.
      const hb = setInterval(() => {
        send("heartbeat", { ts: Date.now() });
      }, 25_000);

      // Cleanup on client disconnect.
      req.signal.addEventListener("abort", () => {
        clearInterval(hb);
        sub.unsubscribe().catch(() => undefined);
        sub.disconnect();
        main.disconnect();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
