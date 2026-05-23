import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#FE5C04",
          color: "#161616",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 26,
          fontWeight: 900,
          letterSpacing: "-0.045em",
          fontFamily: "sans-serif",
          lineHeight: 1,
        }}
      >
        T
      </div>
    ),
    size,
  );
}
