import { NextResponse } from "next/server";
import { fintechsAvailableIn } from "@/lib/available-fintech";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cc = url.searchParams.get("cc") ?? "";
  if (!cc) return NextResponse.json({ rows: [] });
  const rows = await fintechsAvailableIn(cc);
  return NextResponse.json({ rows }, { headers: { "cache-control": "public, max-age=300" } });
}
