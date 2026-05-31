import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const alt = "Trientes coin card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function fmtPrice(n: number): string {
  if (n >= 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(4)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export default async function Image({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { slug } = await params;
  const coin = await prisma.coin.findUnique({
    where: { slug },
    include: { snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 } },
  });

  const snap = coin?.snapshots[0];
  const name = coin?.name ?? "Trientes";
  const symbol = (coin?.symbol ?? "").toUpperCase();
  const price = snap ? Number(snap.priceUsd) : null;
  const pct24h = snap?.pctChange24h ?? null;
  const up = (pct24h ?? 0) >= 0;

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
              width: 36, height: 36, borderRadius: 8,
              background: "#FE5C04",
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

        <div style={{ display: "flex", alignItems: "center", gap: "32px", marginBottom: "auto" }}>
          {coin?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img src={coin.logoUrl} width={120} height={120} style={{ borderRadius: 24 }} />
          ) : (
            <div
              style={{
                width: 120, height: 120, borderRadius: 24, background: "#1f1f1f",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 56, fontWeight: 800, color: "#8b8b8b",
              }}
            >
              {symbol[0] ?? "?"}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 84, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1 }}>
              {name}
            </div>
            <div style={{ fontSize: 36, color: "#9b9b9b", marginTop: 8, letterSpacing: "0.04em" }}>
              {symbol}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 40 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 22, color: "#9b9b9b", marginBottom: 4 }}>Price (USD)</div>
            <div style={{ fontSize: 108, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1 }}>
              {price != null ? fmtPrice(price) : "—"}
            </div>
          </div>
          <div
            style={{
              fontSize: 44, fontWeight: 700,
              color: up ? "#30B658" : "#FE5C04",
              padding: "12px 24px", borderRadius: 16,
              background: up ? "rgba(48, 182, 88, 0.12)" : "rgba(254, 92, 4, 0.12)",
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            <span style={{ fontSize: 32, marginRight: 4 }}>{up ? "▲" : "▼"}</span>
            <span>{fmtPct(pct24h)}</span>
            <span style={{ fontSize: 22, color: "#9b9b9b", marginLeft: 12 }}>24h</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
