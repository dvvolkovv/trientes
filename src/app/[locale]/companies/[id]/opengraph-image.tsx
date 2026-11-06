import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";
import { NOT_DELETED } from "@/lib/soft-delete";

export const runtime = "nodejs";
export const alt = "Trientes company card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { id } = await params;
  const row = await prisma.company.findFirst({
    where: { id, ...NOT_DELETED },
    select: {
      displayName: true, logoUrl: true, country: true, city: true,
      status: true, kybStatus: true,
      points: { where: { status: "APPROVED" }, select: { type: true } },
    },
  });

  const name = row?.displayName ?? "Trientes";
  const location = [row?.city, row?.country].filter(Boolean).join(", ");
  const verified = row?.kybStatus === "APPROVED";
  const placeCount = row?.points.filter((p) => p.type !== "ONLINE").length ?? 0;
  const hasOnline = (row?.points.length ?? 0) > placeCount;

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
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 6 }}>
              <div style={{ fontSize: 22, color: "#9b9b9b", textTransform: "uppercase", letterSpacing: "0.16em" }}>Business</div>
              {verified ? (
                <div
                  style={{
                    fontSize: 20, fontWeight: 700,
                    padding: "4px 14px", borderRadius: 999,
                    background: "rgba(48, 182, 88, 0.18)", color: "#30B658",
                    display: "flex", alignItems: "center",
                  }}
                >
                  ✓ Verified
                </div>
              ) : null}
            </div>
            <div style={{ fontSize: 80, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1 }}>
              {name}
            </div>
            {location ? <div style={{ fontSize: 28, color: "#9b9b9b", marginTop: 12 }}>{location}</div> : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: 32, marginTop: 40 }}>
          {placeCount > 0 ? (
            <Stat label="Crypto-friendly places" value={String(placeCount)} />
          ) : null}
          {hasOnline ? <Stat label="Online services" value="yes" /> : null}
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
