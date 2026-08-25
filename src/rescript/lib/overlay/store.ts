"use client";

import { create } from "zustand";
import {
  DEFAULT_ENTER,
  DEFAULT_EXIT,
  DEFAULT_SUBTITLE_STYLE,
  emptyComposition,
  DEFAULT_FRAME,
  frameRatio,
  type Composition,
  type FrameSpec,
  type ImageElement,
  type OverlayElement,
  type ShapeElement,
  type SubtitleCue,
  type SubtitleStyle,
  type TextElement,
  type Rect,
  type Transition,
  type TransitionKind,
  primaryPlate,
  regionCount,
  type CameraMove,
  type Plate,
  type Shot,
  type ShotLayout,
} from "./types";
import { normaliseShots } from "./shots";
import { withGradeDefaults, type GradeSpec } from "./grade";
import type { AudioClip } from "./audio";
import { forgetImage, loadImage } from "./render";
import { blockedFor, nudgeClear, subtitleBand, overlaps } from "./layout";

/**
 * Composition state, kept deliberately separate from the transcript store.
 *
 * The transcript store is ported code that the cut depends on; wiring overlays
 * into it would mean editing a thousand-line file that already has its own undo
 * semantics tuned to word edits. A second store with its own history keeps the
 * two independent — undoing a caption never walks back a cut, which is also the
 * behaviour people expect.
 */

const MAX_UNDO = 80;

let sequence = 0;
/**
 * Ids carry a random component as well as a counter.
 *
 * The counter alone restarts whenever the module is re-evaluated, and two
 * elements sharing an id makes React drop one of them from the layer list and
 * the timeline without saying so. The random suffix survives that.
 */
function nextId(prefix: string): string {
  sequence += 1;
  const salt = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${sequence}-${salt}`;
}

export interface OverlayState extends Composition {
  /**
   * Required here even though it is optional on a `Composition`.
   *
   * Optional on the stored shape because a save made before the audio layer
   * existed does not have one. In the *store* it is always present — `reset`
   * and `loadComposition` both guarantee an array — and narrowing it here means
   * every action can push to it without a `?? []` that would silently discard a
   * clip if the assumption ever broke.
   */
  audio: AudioClip[];
  selectedId: string | null;
  /** Element ids being dragged/resized, so history coalesces to one entry. */
  gestureActive: boolean;
  past: Composition[];
  future: Composition[];

  /**
   * Aspect (w/h) of the **output frame** — what the composition's 0..1
   * coordinates are relative to. Derived from `frame` and `sourceAspect`; never
   * set directly.
   */
  aspect: number;
  /** Aspect (w/h) of the loaded media itself, for reframing arithmetic. */
  sourceAspect: number;

  setSourceAspect: (aspect: number) => void;
  /** Change the output frame. Undoable, like any other composition edit. */
  setFrame: (patch: Partial<FrameSpec>) => void;

  addElement: (element: OverlayElement) => string;
  addText: (partial?: Partial<TextElement>) => string;
  addImage: (src: string, partial?: Partial<ImageElement>) => string;
  addShape: (partial?: Partial<ShapeElement>) => string;
  updateElement: (id: string, patch: Partial<OverlayElement>) => void;
  /**
   * Move an element to a rect it should be *tidy* in.
   *
   * The difference from `updateElement` is collision avoidance. Dragging says
   * "exactly here" and must be obeyed to the pixel; choosing a preset says "put
   * it in this region", and a preset that drops a caption on top of the
   * subtitles is not doing its job. So the presets go through this and the drag
   * handlers do not.
   */
  placeElement: (id: string, rect: Rect) => void;
  removeElement: (id: string) => void;
  duplicateElement: (id: string) => string | null;
  reorder: (id: string, direction: "front" | "back" | "forward" | "backward") => void;
  select: (id: string | null) => void;

  beginGesture: () => void;
  endGesture: () => void;

  setSubtitleEnabled: (enabled: boolean) => void;
  setSubtitleStyle: (patch: Partial<SubtitleStyle>) => void;
  setCues: (cues: SubtitleCue[]) => void;
  updateCue: (id: string, patch: Partial<SubtitleCue>) => void;
  removeCue: (id: string) => void;

  setTransition: (index: number, kind: TransitionKind, duration?: number) => void;
  setAllTransitions: (kind: TransitionKind, duration?: number) => void;
  replaceTransitions: (transitions: Transition[]) => void;

  /**
   * The project's look, or one shot's.
   *
   * A patch rather than a whole grade, so a slider does not have to know about
   * the other six fields. `null` clears it back to neutral.
   */
  setGrade: (patch: Partial<GradeSpec> | null, shotId?: string) => void;

  /**
   * Add a shot over `start`–`end`, clipping whatever it overlaps.
   *
   * Returns the id. A shot with no plates is given a plain full-frame one, so
   * the caller can add a shot first and decide what goes in it second — the
   * order the UI naturally works in.
   */
  addShot: (shot: Omit<Shot, "id"> & { id?: string }) => string;
  updateShot: (id: string, patch: Partial<Omit<Shot, "id">>) => void;
  /** Patch one plate of a shot, by slot. */
  setPlate: (id: string, slot: number, patch: Partial<Plate>) => void;
  /** Change the layout, adding or trimming plates so the count matches. */
  setLayout: (id: string, layout: ShotLayout) => void;
  setCamera: (id: string, slot: number, camera: CameraMove) => void;
  removeShot: (id: string) => void;
  replaceShots: (shots: Shot[]) => void;

  /** Add a music bed or an effect. Returns the id. */
  addAudio: (clip: Omit<AudioClip, "id"> & { id?: string }) => string;
  updateAudio: (id: string, patch: Partial<Omit<AudioClip, "id">>) => void;
  removeAudio: (id: string) => void;

  loadComposition: (composition: Composition) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}

/**
 * Re-clear every element against a frame that has changed shape.
 *
 * Returns the same array when nothing had to move, so a reframe that breaks
 * nothing costs no re-render and leaves the undo stack describing the frame
 * change alone.
 */
function reflow(state: OverlayState, aspect: number): OverlayElement[] {
  let moved = false;
  const next = state.elements.map((element) => {
    if (element.locked || element.hidden) return element;

    const blocked = blockedFor(
      element.start,
      element.end,
      state.elements,
      state.subtitles,
      element.id,
      aspect
    );
    const placed = nudgeClear(element.rect, blocked);
    if (
      Math.abs(placed.x - element.rect.x) < 1e-6 &&
      Math.abs(placed.y - element.rect.y) < 1e-6 &&
      Math.abs(placed.w - element.rect.w) < 1e-6 &&
      Math.abs(placed.h - element.rect.h) < 1e-6
    ) {
      return element;
    }
    moved = true;
    return { ...element, rect: placed };
  });

  return moved ? next : state.elements;
}

function snapshot(s: OverlayState): Composition {
  return {
    elements: s.elements,
    subtitles: s.subtitles,
    transitions: s.transitions,
    frame: s.frame,
    shots: s.shots,
    grade: s.grade,
    audio: s.audio,
  };
}

/**
 * Lift any element that now sits under the subtitle band.
 *
 * Only elements that actually collide are touched, and only while subtitles are
 * on — turning them off does not drag anything back, because by then the
 * person may well have wanted it where it ended up.
 */
function clearOfSubtitles(
  elements: OverlayElement[],
  subtitles: OverlayState["subtitles"],
  aspect: number
): OverlayElement[] {
  if (!subtitles.enabled || !subtitles.cues.length) return elements;
  const band = subtitleBand(subtitles.style, aspect);

  let changed = false;
  const next = elements.map((element) => {
    if (element.hidden) return element;
    const showing = subtitles.cues.some(
      (c) => c.start < element.end && c.end > element.start
    );
    if (!showing || !overlaps(element.rect, band, 0.02)) return element;
    changed = true;
    return { ...element, rect: nudgeClear(element.rect, [band]) };
  });

  return changed ? next : elements;
}

/** Default placement for a new element: lower third, comfortably inset. */
const DEFAULT_TEXT_RECT = { x: 0.1, y: 0.68, w: 0.8, h: 0.16 };

export const useOverlayStore = create<OverlayState>((set, get) => {
  /** Commit a change, pushing the previous composition onto the undo stack. */
  const commit = (patch: Partial<Composition>) => {
    const state = get();
    const previous = snapshot(state);
    const past = state.gestureActive
      ? state.past
      : [...state.past, previous].slice(-MAX_UNDO);
    set({ ...patch, past, future: [] } as Partial<OverlayState>);
  };

  return {
    ...emptyComposition(),
    // Restated because the stored shape has it optional (older saves have
    // none) while the store's is not. `emptyComposition` already sets it; this
    // is what tells the type system so.
    audio: [],
    selectedId: null,
    gestureActive: false,
    past: [],
    future: [],
    aspect: 16 / 9,
    sourceAspect: 16 / 9,

    setSourceAspect: (sourceAspect) => {
      const next = sourceAspect > 0 ? sourceAspect : 16 / 9;
      if (get().sourceAspect === next) return;
      set({ sourceAspect: next, aspect: frameRatio(get().frame, next) });
    },

    setFrame: (patch) => {
      const previous = get().aspect;
      const frame = { ...get().frame, ...patch };
      const aspect = frameRatio(frame, get().sourceAspect);
      // The output shape is what every rect is a fraction of, so it is kept
      // beside the frame rather than recomputed by each reader.
      set({ aspect });

      // Changing the *shape* moves the ground under everything on screen.
      //
      // Rects are fractions of the frame, so elements survive a reframe rather
      // than sliding off it — that much was already true. What is not true is
      // that they still *work*: the subtitle band is a different height in 9:16
      // than in 16:9 (type is measured against a corrected unit, rects are not),
      // so a lower third that cleared it in widescreen sits under it in
      // vertical, and two captions that were comfortably apart can now touch.
      //
      // This is the same collision pass every other placement goes through, run
      // again against the new shape. A rect somebody dragged is still obeyed to
      // the pixel — this only moves what the new frame has actually broken.
      const changed = Math.abs(aspect - previous) > 0.001;
      commit(changed ? { frame, elements: reflow(get(), aspect) } : { frame });
    },

    addElement: (element) => {
      const { elements, subtitles } = get();
      const z = elements.reduce((m, e) => Math.max(m, e.z), 0) + 1;

      // Placement is enforced, not requested. Whatever asked for this element —
      // a toolbar button or a plan — it must not land on the burned-in
      // subtitles or on something already on screen at the same moment. Two
      // captions sharing pixels is the single most obvious way an automatic
      // edit looks automatic.
      const blocked = blockedFor(
        element.start,
        element.end,
        elements,
        subtitles,
        undefined,
        get().aspect
      );
      const rect = blocked.length
        ? nudgeClear(element.rect, blocked)
        : element.rect;

      const placed = { ...element, z, rect };
      commit({ elements: [...elements, placed] });
      set({ selectedId: placed.id });
      return placed.id;
    },

    addText: (partial = {}) => {
      const element: TextElement = {
        id: nextId("text"),
        kind: "text",
        name: (partial.text ?? "Text").slice(0, 28) || "Text",
        start: partial.start ?? 0,
        end: partial.end ?? (partial.start ?? 0) + 4,
        rect: partial.rect ?? { ...DEFAULT_TEXT_RECT },
        rotation: 0,
        opacity: 1,
        z: 0,
        locked: false,
        hidden: false,
        enter: partial.enter ?? { ...DEFAULT_ENTER },
        exit: partial.exit ?? { ...DEFAULT_EXIT },
        text: partial.text ?? "Your text here",
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        fontWeight: 700,
        italic: false,
        fontSize: 0.07,
        color: "#ffffff",
        align: "center",
        lineHeight: 1.18,
        letterSpacing: -0.01,
        uppercase: false,
        background: null,
        padding: 0.35,
        radius: 0.18,
        shadow: true,
        strokeColor: null,
        strokeWidth: 0.06,
        ...partial,
      };
      return get().addElement(element);
    },

    addImage: (src, partial = {}) => {
      // Warm the decode now so the first painted frame has it.
      void loadImage(src).catch(() => null);
      const aspect = get().aspect;
      // A square-ish default that fits any frame; the user resizes from there.
      const w = partial.rect?.w ?? 0.34;
      const h = partial.rect?.h ?? (w * aspect) / 1;
      const element: ImageElement = {
        id: nextId("image"),
        kind: "image",
        name: partial.name ?? "Image",
        start: partial.start ?? 0,
        end: partial.end ?? (partial.start ?? 0) + 4,
        rect: partial.rect ?? { x: 0.06, y: 0.1, w, h: Math.min(h, 0.6) },
        rotation: 0,
        opacity: 1,
        z: 0,
        locked: false,
        hidden: false,
        enter: partial.enter ?? { kind: "scaleUp", duration: 0.4, easing: "backOut" },
        exit: partial.exit ?? { ...DEFAULT_EXIT },
        src,
        fit: "contain",
        radius: 0.03,
        shadow: true,
        ...partial,
      };
      return get().addElement(element);
    },

    addShape: (partial = {}) => {
      // A mark is a drawn gesture and a rectangle is a plate to put something
      // on, so their defaults are opposites: one wants ink and no fill, the
      // other a fill and no ink. Getting this wrong makes every placed arrow
      // arrive as an invisible black-on-black box.
      const isMark = partial.shape === "path";
      const element: ShapeElement = {
        id: nextId("shape"),
        kind: "shape",
        name: partial.name ?? (isMark ? (partial.pathName ?? "Mark") : "Shape"),
        start: partial.start ?? 0,
        end: partial.end ?? (partial.start ?? 0) + 4,
        rect:
          partial.rect ??
          (isMark
            ? // Square, because a mark is scaled to fit and a wide box would
              // simply centre it in empty space.
              { x: 0.38, y: 0.34, w: 0.24, h: 0.24 }
            : { x: 0.08, y: 0.62, w: 0.84, h: 0.22 }),
        rotation: 0,
        opacity: 1,
        z: 0,
        locked: false,
        hidden: false,
        enter: partial.enter ?? { ...DEFAULT_ENTER },
        exit: partial.exit ?? { ...DEFAULT_EXIT },
        shape: "rect",
        fill: isMark ? null : "rgba(0,0,0,0.55)",
        strokeColor: isMark ? "#ffd60a" : null,
        strokeWidth: isMark ? 0.009 : 0.004,
        radius: 0.06,
        ...partial,
      };
      return get().addElement(element);
    },

    updateElement: (id, patch) => {
      const { elements } = get();
      const index = elements.findIndex((e) => e.id === id);
      if (index < 0) return;
      const next = [...elements];
      // The cast is safe because callers only ever patch fields of the element's
      // own kind; `kind` itself is never in a patch.
      next[index] = { ...next[index], ...patch } as OverlayElement;
      commit({ elements: next });
    },

    placeElement: (id, rect) => {
      const { elements, subtitles } = get();
      const element = elements.find((e) => e.id === id);
      if (!element) return;
      const blocked = blockedFor(
        element.start,
        element.end,
        elements,
        subtitles,
        id,
        get().aspect
      );
      get().updateElement(id, {
        rect: blocked.length ? nudgeClear(rect, blocked) : rect,
      });
    },

    removeElement: (id) => {
      const { elements, selectedId } = get();
      const gone = elements.find((e) => e.id === id);
      commit({ elements: elements.filter((e) => e.id !== id) });
      if (selectedId === id) set({ selectedId: null });
      // Only drop the decoded bitmap when nothing else points at it.
      if (gone?.kind === "image") {
        const stillUsed = get().elements.some(
          (e) => e.kind === "image" && e.src === gone.src
        );
        if (!stillUsed && gone.src.startsWith("blob:")) {
          URL.revokeObjectURL(gone.src);
          forgetImage(gone.src);
        }
      }
    },

    duplicateElement: (id) => {
      const source = get().elements.find((e) => e.id === id);
      if (!source) return null;
      const copy = {
        ...source,
        id: nextId(source.kind),
        name: `${source.name} copy`,
        rect: {
          ...source.rect,
          x: Math.min(0.9, source.rect.x + 0.03),
          y: Math.min(0.9, source.rect.y + 0.03),
        },
      } as OverlayElement;
      return get().addElement(copy);
    },

    reorder: (id, direction) => {
      const elements = [...get().elements].sort((a, b) => a.z - b.z);
      const index = elements.findIndex((e) => e.id === id);
      if (index < 0) return;
      let target = index;
      if (direction === "front") target = elements.length - 1;
      else if (direction === "back") target = 0;
      else if (direction === "forward") target = Math.min(elements.length - 1, index + 1);
      else target = Math.max(0, index - 1);
      if (target === index) return;
      const [moved] = elements.splice(index, 1);
      elements.splice(target, 0, moved);
      // Re-stack from 1 so z stays dense and comparable.
      commit({ elements: elements.map((e, i) => ({ ...e, z: i + 1 })) });
    },

    select: (id) => set({ selectedId: id }),

    beginGesture: () => {
      const state = get();
      if (state.gestureActive) return;
      set({
        gestureActive: true,
        past: [...state.past, snapshot(state)].slice(-MAX_UNDO),
        future: [],
      });
    },
    endGesture: () => set({ gestureActive: false }),

    setSubtitleEnabled: (enabled) => {
      const subtitles = { ...get().subtitles, enabled };
      commit({
        subtitles,
        elements: clearOfSubtitles(get().elements, subtitles, get().aspect),
      });
    },

    setSubtitleStyle: (patch) => {
      const subtitles = {
        ...get().subtitles,
        style: { ...get().subtitles.style, ...patch },
      };
      // Moving the subtitles to the middle of the frame is exactly when an
      // existing caption ends up underneath them, so the elements are re-checked
      // against the new band rather than left where they were.
      commit({
        subtitles,
        elements: clearOfSubtitles(get().elements, subtitles, get().aspect),
      });
    },

    setCues: (cues) =>
      commit({
        subtitles: { ...get().subtitles, cues, generated: true },
      }),

    updateCue: (id, patch) => {
      const { subtitles } = get();
      commit({
        subtitles: {
          ...subtitles,
          cues: subtitles.cues.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        },
      });
    },

    removeCue: (id) => {
      const { subtitles } = get();
      commit({
        subtitles: {
          ...subtitles,
          cues: subtitles.cues.filter((c) => c.id !== id),
        },
      });
    },

    setTransition: (index, kind, duration) => {
      const existing = get().transitions;
      const rest = existing.filter((t) => t.index !== index);
      if (kind === "none") {
        commit({ transitions: rest });
        return;
      }
      const previous = existing.find((t) => t.index === index);
      commit({
        transitions: [
          ...rest,
          { index, kind, duration: duration ?? previous?.duration ?? 0.5 },
        ].sort((a, b) => a.index - b.index),
      });
    },

    setAllTransitions: (kind, duration) => {
      if (kind === "none") {
        commit({ transitions: [] });
        return;
      }
      // Boundary indices are owned by the timeline, not by this store, so
      // "all" is expressed against whatever is already known plus whatever the
      // caller supplies via replaceTransitions. The AI path uses that; this one
      // rewrites the kinds already present.
      commit({
        transitions: get().transitions.map((t) => ({
          ...t,
          kind,
          duration: duration ?? t.duration,
        })),
      });
    },

    replaceTransitions: (transitions) =>
      commit({ transitions: [...transitions].sort((a, b) => a.index - b.index) }),

    setGrade: (patch, shotId) => {
      if (!shotId) {
        commit({
          grade: patch === null ? null : withGradeDefaults({ ...get().grade, ...patch }),
        });
        return;
      }
      const shots = get().shots.map((s) =>
        s.id === shotId
          ? {
              ...s,
              grade:
                patch === null
                  ? null
                  : withGradeDefaults({ ...(s.grade ?? get().grade), ...patch }),
            }
          : s
      );
      commit({ shots });
    },

    /* ---------------------------------- audio ---------------------------------- */

    addAudio: (input) => {
      const id = input.id ?? nextId("audio");
      commit({ audio: [...get().audio, { ...input, id }] });
      return id;
    },

    updateAudio: (id, patch) =>
      commit({
        audio: get().audio.map((clip) =>
          clip.id === id ? { ...clip, ...patch } : clip
        ),
      }),

    removeAudio: (id) =>
      commit({ audio: get().audio.filter((clip) => clip.id !== id) }),

    /* ---------------------------------- shots ---------------------------------- */

    addShot: (input) => {
      const id = input.id ?? nextId("shot");
      const plates = input.plates?.length ? input.plates : [primaryPlate()];
      const shot: Shot = { ...input, id, plates };
      // Normalised on the way in rather than at read time: `shotAt` returns the
      // first match, so an overlap left here would be silently invisible.
      commit({ shots: normaliseShots([...get().shots, shot]) });
      return id;
    },

    updateShot: (id, patch) => {
      const shots = get().shots.map((s) => (s.id === id ? { ...s, ...patch } : s));
      commit({ shots: normaliseShots(shots) });
    },

    setPlate: (id, slot, patch) => {
      const shots = get().shots.map((s) => {
        if (s.id !== id) return s;
        const plates = s.plates.map((p) => (p.slot === slot ? { ...p, ...patch } : p));
        return { ...s, plates };
      });
      commit({ shots });
    },

    setLayout: (id, layout) => {
      const shots = get().shots.map((s) => {
        if (s.id !== id) return s;
        const want = regionCount(layout, s.plates.length);
        const plates = s.plates.slice(0, want);
        // Growing into a new layout fills the extra regions with the footage
        // rather than with nothing: an empty half-frame reads as a bug, and
        // "the same shot twice" is at least a picture someone can then change.
        while (plates.length < want) {
          plates.push({ ...primaryPlate(), slot: plates.length });
        }
        // Slots are re-seated because a plate list that survived a trim can
        // otherwise carry a slot the new layout has no region for.
        return { ...s, layout, plates: plates.map((p, i) => ({ ...p, slot: i })) };
      });
      commit({ shots });
    },

    setCamera: (id, slot, camera) => get().setPlate(id, slot, { camera }),

    removeShot: (id) => commit({ shots: get().shots.filter((s) => s.id !== id) }),

    replaceShots: (shots) => commit({ shots: normaliseShots(shots) }),

    loadComposition: (composition) => {
      const frame = composition.frame ?? { ...DEFAULT_FRAME };
      set({
        elements: composition.elements ?? [],
        subtitles: composition.subtitles ?? {
          enabled: false,
          style: { ...DEFAULT_SUBTITLE_STYLE },
          cues: [],
          generated: false,
        },
        transitions: composition.transitions ?? [],
        frame,
        // A save written before shots existed has none, and none means one
        // full-frame plate of the footage — which is what it rendered as.
        shots: composition.shots ?? [],
        grade: composition.grade ?? null,
        // Absent on a save made before there was an audio layer, and absent
        // means silence — which is what those projects exported as.
        audio: composition.audio ?? [],
        aspect: frameRatio(frame, get().sourceAspect),
        selectedId: null,
        // A loaded composition is a new starting point, not a step: undoing
        // into the previous project's captions is the bug this store had.
        past: [],
        future: [],
      });
    },

    undo: () => {
      const state = get();
      const previous = state.past[state.past.length - 1];
      if (!previous) return;
      set({
        ...previous,
        aspect: frameRatio(previous.frame ?? state.frame, state.sourceAspect),
        past: state.past.slice(0, -1),
        future: [snapshot(state), ...state.future].slice(0, MAX_UNDO),
        selectedId: previous.elements.some((e) => e.id === state.selectedId)
          ? state.selectedId
          : null,
      });
    },

    redo: () => {
      const state = get();
      const next = state.future[0];
      if (!next) return;
      set({
        ...next,
        aspect: frameRatio(next.frame ?? state.frame, state.sourceAspect),
        past: [...state.past, snapshot(state)].slice(-MAX_UNDO),
        future: state.future.slice(1),
        selectedId: next.elements.some((e) => e.id === state.selectedId)
          ? state.selectedId
          : null,
      });
    },

    reset: () => {
      // Every blob URL this composition owns dies with it. Without this a
      // project switch leaks the whole overlay image set for the life of the
      // tab — and a decoded 4K still is not a small thing to leak.
      for (const element of get().elements) {
        if (element.kind !== "image") continue;
        if (!element.src.startsWith("blob:")) continue;
        URL.revokeObjectURL(element.src);
        forgetImage(element.src);
      }
      const fresh = emptyComposition();
      set({
        ...fresh,
        aspect: frameRatio(fresh.frame, get().sourceAspect),
        selectedId: null,
        gestureActive: false,
        past: [],
        future: [],
      });
    },
  };
});

/** Read the composition without subscribing. Used by the exporter. */
export function currentComposition(): Composition {
  const s = useOverlayStore.getState();
  return {
    elements: s.elements,
    subtitles: s.subtitles,
    transitions: s.transitions,
    frame: s.frame,
    shots: s.shots,
    grade: s.grade,
    audio: s.audio,
  };
}
