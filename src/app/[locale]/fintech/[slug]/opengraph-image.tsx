import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const alt = "Trientes fintech card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const SERVICE_LABELS: Record<string, string> = {
  CARD: "Card", IBAN: "IBAN", SEPA: "SEPA", SWIFT: "SWIFT", SAVINGS: "Savings",
  CRYPTO_LOANS: "Loans", STAKING: "Staking", EXCHANGE: "Exchange", CUSTODY: "Custody",
  PAYMENTS: "Payments", ONRAMP: "On-ramp", OFFRAMP: "Off-ramp",
};

export default async function Image({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { slug } = await params;
  const row = await prisma.fintechCompany.findUnique({
    where: { slug },
    select: { displayName: true, logoUrl: true, services: true, availableIn: true, status: true, countryCode: true },
  });

  const name = row?.displayName ?? "Trientes";
  const services = (row?.services ?? []).slice(0, 6);
  const countries = (row?.availableIn ?? []).length;
  const country = row?.countryCode ?? null;

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

        <div style={{ display: "flex", alignItems: "center", gap: "40px", marginBottom: 32 }}>
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
            <div style={{ fontSize: 22, color: "#A855F7", textTransform: "uppercase", letterSpacing: "0.16em" }}>Fintech</div>
            <div style={{ fontSize: 80, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, marginTop: 6 }}>
              {name}
            </div>
            {country ? <div style={{ fontSize: 26, color: "#9b9b9b", marginTop: 10 }}>HQ: {country}</div> : null}
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: "auto", marginBottom: 16 }}>
          {services.map((s) => (
            <div
              key={s}
              style={{
                fontSize: 24, fontWeight: 600,
                padding: "10px 20px", borderRadius: 12,
                background: "rgba(168, 85, 247, 0.15)", color: "#d8b4fe",
              }}
            >
              {SERVICE_LABELS[s] ?? s}
            </div>
          ))}
        </div>

        {countries > 0 ? (
          <div style={{ fontSize: 26, color: "#9b9b9b", marginTop: 8, display: "flex", gap: 8 }}>
            <span>Available in</span>
            <span style={{ color: "#fafafa", fontWeight: 600 }}>{countries}</span>
            <span>countries</span>
          </div>
        ) : null}
      </div>
    ),
    { ...size },
  );
}
