import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "Trientes — the ledger of digital coinage";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%", width: "100%", display: "flex", flexDirection: "column",
          background: "linear-gradient(135deg, #0a0a0a 0%, #1a0f08 100%)",
          color: "#fafafa", padding: "72px 80px", fontFamily: "system-ui, sans-serif",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 56, height: 56, borderRadius: 14, background: "#FE5C04",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, fontSize: 34, color: "#0a0a0a",
            }}
          >
            T
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.01em", display: "flex" }}>
            <span>trientes</span>
            <span style={{ color: "#FE5C04" }}>.org</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 120, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.0 }}>
            the ledger
          </div>
          <div
            style={{
              fontSize: 120, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.0,
              display: "flex", gap: 24,
            }}
          >
            <span>of digital</span>
            <span style={{ color: "#FE5C04" }}>coinage</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 32, fontSize: 26, color: "#9b9b9b" }}>
          <div>Live prices</div>
          <div>·</div>
          <div>Exchanges</div>
          <div>·</div>
          <div>Fintech</div>
          <div>·</div>
          <div>Crypto navigator</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
