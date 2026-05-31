import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const alt = "Trientes exchange card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function fmtVol(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

export default async function Image({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { id } = await params;
  const row = await prisma.exchange.findUnique({
    where: { id },
    select: { name: true, logoUrl: true, country: true, trustScore: true, trustScoreRank: true, volume24hBtc: true },
  });

  const name = row?.name ?? "Trientes";
  const country = row?.country ?? null;
  const trust = row?.trustScore ?? null;
  const rank = row?.trustScoreRank ?? null;
  // volume24hBtc is stored in BTC; rough USD conversion is too volatile for an
  // OG image, so we just label the BTC number and skip the USD math.
  const volBtc = row?.volume24hBtc ?? null;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%", width: "100%", display: "flex", flexDirection: "column",
          background: "linear-gradient(135deg, #0a0a0a 0%, #161616 100%)",
          color: "#fafafa", padding: "64px 72px", fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "40px" }}>
          <div
            style={{
              width: 36, height: 36, borderRadius: 8, background: "#FE5C04",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, fontSize: 22, color: "#0a0a0a",
            }}
          >
            T
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", display: "flex" }}>
            <span>trientes</span>
            <span style={{ color: "#FE5C04" }}>.org</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "40px", marginBottom: "auto" }}>
          {row?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img src={row.logoUrl} width={140} height={140} style={{ borderRadius: 28 }} />
          ) : (
            <div
              style={{
                width: 140, height: 140, borderRadius: 28, background: "#1f1f1f",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 64, fontWeight: 800, color: "#8b8b8b",
              }}
            >
              {name[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 22, color: "#9b9b9b", textTransform: "uppercase", letterSpacing: "0.16em" }}>Exchange</div>
            <div style={{ fontSize: 86, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, marginTop: 6 }}>
              {name}
            </div>
            {country ? <div style={{ fontSize: 28, color: "#9b9b9b", marginTop: 12 }}>{country}</div> : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: "32px", marginTop: 40 }}>
          {trust != null ? (
            <Stat label="Trust score" value={`${trust}/10`} />
          ) : null}
          {rank != null ? (
            <Stat label="Rank" value={`#${rank}`} />
          ) : null}
          {volBtc != null ? (
            <Stat label="24h volume" value={`${fmtVol(volBtc)} BTC`} />
          ) : null}
        </div>
      </div>
    ),
    { ...size },
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 18, color: "#9b9b9b", textTransform: "uppercase", letterSpacing: "0.16em" }}>{label}</div>
      <div style={{ fontSize: 56, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 4 }}>{value}</div>
    </div>
  );
}
