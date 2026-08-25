"use client";

import { useEditorStore } from "@/rescript/lib/store";
import { useOutputTimeline } from "@/rescript/hooks/useOverlayTimeline";
import { useOverlayStore } from "@/rescript/lib/overlay/store";
import {
  clampTransitionDuration,
  familyOf,
} from "@/rescript/lib/overlay/timeline";
import {
  TRANSITION_LABELS,
  type TransitionKind,
} from "@/rescript/lib/overlay/types";
import { Button, Empty, Row, Section, Select, Slider, formatSeconds } from "./ui";

/**
 * What happens at each cut.
 *
 * The two families behave differently on purpose. A *dip* (fade, blur, zoom in)
 * treats whichever clip is live and sits symmetrically across the cut. A *push*
 * (dissolve, slide, zoom out) holds the outgoing clip's last frame and moves it
 * away over the incoming one. Neither borrows frames from across the cut and
 * neither shortens the video, so a transition can never clip speech or put a
 * deleted word back on screen — which is the constraint that matters in an
 * editor where the cuts land on word boundaries.
 */

/**
 * Ordered by how often each is the right answer, not by family.
 *
 * `morphCut` sits directly after "Cut" because it is the one this editor
 * specifically needs: deleting words is how it cuts, so it manufactures jump
 * cuts on a talking head, and hiding those is a more common job here than any
 * other transition in the list.
 */
const KINDS: TransitionKind[] = [
  "none",
  "morphCut",
  "dissolve",
  "fadeBlack",
  "fadeWhite",
  "whipPan",
  "zoomBlur",
  "iris",
  "slideLeft",
  "slideRight",
  "slideUp",
  "slideDown",
  "zoomIn",
  "zoomOut",
  "blur",
];

export default function TransitionsPanel() {
  const timeline = useOutputTimeline();
  const transitions = useOverlayStore((s) => s.transitions);
  const setTransition = useOverlayStore((s) => s.setTransition);
  const replaceTransitions = useOverlayStore((s) => s.replaceTransitions);
  const seekTo = useEditorStore((s) => s.seekTo);

  const boundaries = timeline.boundaries;

  if (!boundaries.length) {
    return (
      <Empty>
        The video is one continuous clip, so there is no cut to put a transition
        on. Delete some words, or split at the playhead with S.
      </Empty>
    );
  }

  const applyAll = (kind: TransitionKind, duration = 0.5) => {
    if (kind === "none") {
      replaceTransitions([]);
      return;
    }
    replaceTransitions(
      boundaries.map((b) => ({ index: b.index, kind, duration }))
    );
  };

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <Section title="All cuts">
        <Row label="Set every">
          <Select
            value={"" as TransitionKind | ""}
            options={[
              { value: "" as TransitionKind, label: `Apply to all ${boundaries.length}…` },
              ...KINDS.map((kind) => ({
                value: kind,
                label: TRANSITION_LABELS[kind],
              })),
            ]}
            onChange={(kind) => kind && applyAll(kind)}
          />
        </Row>
        <Button className="mt-1 w-full" onClick={() => replaceTransitions([])}>
          Clear them all
        </Button>
      </Section>

      <Section title={`Cuts (${boundaries.length})`}>
        <ul className="space-y-2">
          {boundaries.map((boundary) => {
            const spec = transitions.find((t) => t.index === boundary.index);
            const kind = spec?.kind ?? "none";
            const requested = spec?.duration ?? 0.5;
            const effective = clampTransitionDuration(boundary, kind, requested);
            // A short neighbouring clip cannot give the transition the room it
            // asked for; say so rather than quietly playing something shorter.
            const clamped = kind !== "none" && effective < requested - 0.01;

            return (
              <li
                key={boundary.index}
                className="rounded-lg border border-zinc-200 px-2 py-2 dark:border-zinc-800"
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200">
                    Cut {boundary.index}
                  </span>
                  <button
                    type="button"
                    onClick={() => seekTo(boundary.incomingStart)}
                    title="Jump to this cut"
                    className="cursor-pointer text-[10px] tabular-nums text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    {formatSeconds(boundary.outTime)}
                  </button>
                </div>

                <Row label="Motion">
                  <Select
                    value={kind}
                    options={KINDS.map((k) => ({
                      value: k,
                      label: TRANSITION_LABELS[k],
                    }))}
                    onChange={(next) =>
                      setTransition(boundary.index, next, requested)
                    }
                  />
                </Row>

                {kind !== "none" && (
                  <>
                    <Row label="Length">
                      <Slider
                        value={requested}
                        min={0.1}
                        max={2}
                        step={0.05}
                        onChange={(duration) =>
                          setTransition(boundary.index, kind, duration)
                        }
                        format={(v) => `${v.toFixed(2)}s`}
                      />
                    </Row>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                      {familyOf(kind) === "dip"
                        ? "Sits across the cut, half on each side."
                        : "Holds the last frame and moves it off after the cut."}
                      {clamped &&
                        ` Trimmed to ${effective.toFixed(2)}s — the neighbouring clip is too short.`}
                    </p>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
