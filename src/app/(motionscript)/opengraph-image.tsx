import { ImageResponse } from "next/og";

/** The social card. Mark, name, and what the thing actually does. */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "MotionScript — edit videos like you edit text";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#0a0a0b",
          color: "#f2f2f0",
          padding: "0 96px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#f2f2f0",
              color: "#0a0a0b",
              fontSize: 36,
              fontWeight: 600,
            }}
          >
            M
          </div>
          <div style={{ fontSize: 34, fontWeight: 500, letterSpacing: "-0.02em" }}>
            MotionScript
          </div>
        </div>

        <div
          style={{
            marginTop: 44,
            fontSize: 76,
            fontWeight: 500,
            lineHeight: 1.05,
            letterSpacing: "-0.04em",
            maxWidth: 900,
          }}
        >
          Edit videos like you edit text.
        </div>

        <div style={{ marginTop: 28, fontSize: 27, color: "#8a8a85", maxWidth: 780 }}>
          Transcript-based editing, entirely in your browser.
        </div>
      </div>
    ),
    size,
  );
}
