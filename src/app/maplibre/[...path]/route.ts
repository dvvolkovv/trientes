import { serveMapLibreAsset } from "@/lib/maplibre-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return serveMapLibreAsset((await params).path);
}
