"use client";

import { useId } from "react";
import { useI18n } from "./I18nProvider";

/**
 * Filled silhouette of the MotionScript "M", used to clip the sliding bars.
 *
 * Geometric rather than typographic: straight cuts and hard corners are the
 * house language, and the shape reads at 20px where a drawn letterform would
 * turn to mush. Kept in the same 58x61 box as the mark it replaced so the
 * bar rows, slots and stagger below all still line up.
 */
const M_PATH =
  "M0 61V0H14L29 27L44 0H58V61H45V23L29 50L13 23V61H0Z";
const VIEW_W = 58;
const VIEW_H = 61;

// Each row is a pair of rounded bars with a slot between them, both running far
// past the silhouette so the R's outline never breaks as the pair slides — only
// the slot travels across, sweeping the logo's cut-outs left and right.
// Uneven slot centres and widths give every row its own bar lengths, and odd
// rows run the reversed keyframes so neighbours sweep against each other.
const SLOTS = [
  { center: 31, width: 12 },
  { center: 26, width: 19 },
  { center: 33, width: 10 },
  { center: 27, width: 16 },
];
const ROW_GAP = 5.5;
const ROW_HEIGHT = (VIEW_H - (SLOTS.length - 1) * ROW_GAP) / SLOTS.length;
const OVERHANG = 70;
/** Seconds between neighbouring rows, applied as a negative delay so the slots fan out. */
const ROW_STAGGER = 0.11;

export default function LogoLoader({
  size = 44,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const { t } = useI18n();
  // Ids must be unique per instance, and React's contain colons that trip up url().
  const clipId = `logo-m-${useId().replace(/:/g, "")}`;
  const markHeight = size * 0.56;

  return (
    <div
      role="img"
      aria-label={t("common.loading")}
      className={`flex items-center justify-center rounded-[22%] bg-transparent text-zinc-900 dark:text-zinc-100 ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        width={(markHeight * VIEW_W) / VIEW_H}
        height={markHeight}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        fill="none"
      >
        <defs>
          <clipPath id={clipId}>
            <path d={M_PATH} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`} fill="currentColor">
          {SLOTS.map(({ center, width }, i) => {
            const y = i * (ROW_HEIGHT + ROW_GAP);
            const slotStart = center - width / 2;
            return (
              <g
                key={i}
                className={i % 2 ? "logo-bar logo-bar-alt" : "logo-bar"}
                style={{ animationDelay: `${-i * ROW_STAGGER}s` }}
              >
                <rect
                  x={-OVERHANG}
                  y={y}
                  width={OVERHANG + slotStart}
                  height={ROW_HEIGHT}
                  rx={ROW_HEIGHT / 2}
                />
                <rect
                  x={slotStart + width}
                  y={y}
                  width={OVERHANG}
                  height={ROW_HEIGHT}
                  rx={ROW_HEIGHT / 2}
                />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
