/**
 * The MotionScript mark.
 *
 * The same square "M" the studio wears in its top bar, so the two apps carry
 * one identity. Drawn rather than imported: the old logo was a raster of
 * another project's "R", and a 22px glyph on a filled square does not need a
 * PNG — this scales to any size, needs no asset pipeline, and inherits the
 * theme instead of baking a colour into pixels.
 */
export default function Mark({
  size = 18,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center bg-zinc-100 text-zinc-950 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span
        style={{
          fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
          fontSize: size * 0.62,
          fontWeight: 500,
          lineHeight: 1,
        }}
      >
        M
      </span>
    </span>
  );
}
