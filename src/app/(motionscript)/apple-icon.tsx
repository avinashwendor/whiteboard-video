import { ImageResponse } from "next/og";

/** Touch icon. Same mark, sized for a home screen, on the app's own ground. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0b",
          color: "#f2f2f0",
          fontSize: 116,
          fontWeight: 600,
          letterSpacing: "-0.04em",
        }}
      >
        M
      </div>
    ),
    size,
  );
}
