import { NextResponse } from "next/server";
import { fintechsAvailableIn } from "@/lib/available-fintech";
import { exchangesRegisteredIn } from "@/lib/available-exchanges";

export const dynamic = "force-dynamic";

// Одним запросом — то, что полоса над картой показывает по стране центра:
// биржи каталога (по стране регистрации) и финтех (по заявленной доступности).
// Точки приёма сюда не входят: их считает сама карта по тому, что видно.
export async function GET(req: Request) {
  const cc = (new URL(req.url).searchParams.get("cc") ?? "").trim();
  if (!/^[a-z]{2}$/i.test(cc)) return NextResponse.json({ exchanges: [], fintechs: [] });
  const [exchanges, fintechs] = await Promise.all([
    exchangesRegisteredIn(cc).catch(() => []),
    fintechsAvailableIn(cc).catch(() => []),
  ]);
  return NextResponse.json(
    { exchanges, fintechs },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
