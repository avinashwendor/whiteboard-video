import { ImageResponse } from "next/og";

/**
 * The tab icon, generated rather than shipped.
 *
 * The three PNGs this replaces were the upstream project's "R". Drawing the
 * mark here means there is no binary to keep in sync with the brand, and the
 * favicon, the touch icon and the social card cannot drift apart.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f2f2f0",
          color: "#0a0a0b",
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.03em",
        }}
      >
        M
      </div>
    ),
    size,
  );
}
