"use client";

import { useOverlayStore } from "@/motionscript/lib/overlay/store";
import {
  ANIMATION_KINDS,
  ANIMATION_LABELS,
  EASING_NAMES,
} from "@/motionscript/lib/overlay/animation";
import {
  rectAt,
  TEXT_STYLES,
  TEXT_STYLE_LABELS,
  textBoxHeight,
} from "@/motionscript/lib/overlay/presets";
import { POSITIONS, type TextStyleName } from "@/motionscript/lib/overlay/ops-schema";
import { useOutputTime } from "@/motionscript/hooks/useOverlayTimeline";
import type {
  AnimationKind,
  AnimationSpec,
  EasingName,
  ImageElement,
  OverlayElement,
  ShapeElement,
  TextElement,
} from "@/motionscript/lib/overlay/types";
import {
  Button,
  ColorInput,
  Empty,
  NumberInput,
  Row,
  Section,
  Segmented,
  Select,
  Slider,
  TextInput,
} from "./ui";

/** Everything about the one element that is selected. */
export default function InspectorPanel() {
  const selectedId = useOverlayStore((s) => s.selectedId);
  const element = useOverlayStore((s) =>
    s.elements.find((e) => e.id === s.selectedId)
  );
  const at = useOutputTime();

  if (!selectedId || !element) {
    return (
      <Empty>
        Select something on the video — or in Layers — to change how it looks.
      </Empty>
    );
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <TimingSection element={element} at={at} />
      {element.kind === "text" && <TextSection element={element} />}
      {element.kind === "image" && <ImageSection element={element} />}
      {element.kind === "shape" && <ShapeSection element={element} />}
      <PlacementSection element={element} />
      <AnimationSection element={element} />
    </div>
  );
}

function useUpdate(id: string) {
  const update = useOverlayStore((s) => s.updateElement);
  return (patch: Partial<OverlayElement>) => update(id, patch);
}

/* --------------------------------- timing ---------------------------------- */

function TimingSection({
  element,
  at,
}: {
  element: OverlayElement;
  at: number;
}) {
  const update = useUpdate(element.id);
  const length = element.end - element.start;

  return (
    <Section
      title="On screen"
      action={
        <span className="text-[10px] tabular-nums text-zinc-400">
          {length.toFixed(1)}s
        </span>
      }
    >
      <Row label="Start">
        <NumberInput
          value={element.start}
          min={0}
          step={0.1}
          suffix="s"
          onChange={(v) =>
            update({ start: Math.max(0, Math.min(v, element.end - 0.2)) })
          }
        />
      </Row>
      <Row label="End">
        <NumberInput
          value={element.end}
          min={0}
          step={0.1}
          suffix="s"
          onChange={(v) => update({ end: Math.max(element.start + 0.2, v) })}
        />
      </Row>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Button
          onClick={() => update({ start: at })}
          title="Move the start to the playhead, keeping the length"
        >
          Start here
        </Button>
        <Button
          onClick={() => update({ end: Math.max(element.start + 0.2, at) })}
          title="End at the playhead"
        >
          End here
        </Button>
      </div>
    </Section>
  );
}

/* ---------------------------------- text ----------------------------------- */

function TextSection({ element }: { element: TextElement }) {
  const update = useUpdate(element.id);

  return (
    <Section title="Text">
      <div className="mb-2">
        <TextInput
          value={element.text}
          multiline
          onChange={(text) =>
            update({ text, name: text.slice(0, 28) || "Text" } as Partial<OverlayElement>)
          }
        />
      </div>

      <Row label="Look">
        <Select
          value={"" as TextStyleName | ""}
          options={[
            { value: "" as TextStyleName, label: "Apply a look…" },
            ...(Object.keys(TEXT_STYLES) as TextStyleName[]).map((id) => ({
              value: id,
              label: TEXT_STYLE_LABELS[id],
            })),
          ]}
          onChange={(id) => {
            if (!id) return;
            const { sizeScale, ...fields } = TEXT_STYLES[id];
            const fontSize = sizeScale
              ? Math.min(0.3, element.fontSize * sizeScale)
              : element.fontSize;
            update({
              ...fields,
              fontSize,
              rect: { ...element.rect, h: textBoxHeight(fontSize) },
            } as Partial<OverlayElement>);
          }}
        />
      </Row>

      <Row label="Size">
        <Slider
          value={element.fontSize}
          min={0.015}
          max={0.28}
          step={0.002}
          onChange={(fontSize) =>
            update({
              fontSize,
              rect: { ...element.rect, h: textBoxHeight(fontSize) },
            } as Partial<OverlayElement>)
          }
          format={(v) => `${Math.round(v * 1000)}`}
        />
      </Row>
      <Row label="Colour">
        <ColorInput
          value={element.color}
          onChange={(color) => update({ color: color ?? "#ffffff" } as Partial<OverlayElement>)}
        />
      </Row>
      <Row label="Behind" hint="A slab behind the words, for footage that is busy">
        <ColorInput
          value={element.background}
          allowNone
          onChange={(background) =>
            update({ background } as Partial<OverlayElement>)
          }
        />
      </Row>
      <Row label="Outline">
        <ColorInput
          value={element.strokeColor}
          allowNone
          onChange={(strokeColor) =>
            update({ strokeColor } as Partial<OverlayElement>)
          }
        />
      </Row>
      <Row label="Align">
        <Segmented
          value={element.align}
          onChange={(align) => update({ align } as Partial<OverlayElement>)}
          options={[
            { value: "left" as const, label: "Left" },
            { value: "center" as const, label: "Centre" },
            { value: "right" as const, label: "Right" },
          ]}
        />
      </Row>
      <Row label="Weight">
        <Slider
          value={element.fontWeight}
          min={300}
          max={900}
          step={100}
          onChange={(fontWeight) =>
            update({ fontWeight } as Partial<OverlayElement>)
          }
          format={(v) => `${v}`}
        />
      </Row>
      <Row label="Tracking">
        <Slider
          value={element.letterSpacing}
          min={-0.06}
          max={0.2}
          step={0.005}
          onChange={(letterSpacing) =>
            update({ letterSpacing } as Partial<OverlayElement>)
          }
          format={(v) => v.toFixed(3)}
        />
      </Row>
      <Row label="Line height">
        <Slider
          value={element.lineHeight}
          min={0.9}
          max={2}
          step={0.02}
          onChange={(lineHeight) =>
            update({ lineHeight } as Partial<OverlayElement>)
          }
        />
      </Row>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <Button
          variant={element.uppercase ? "solid" : "ghost"}
          onClick={() =>
            update({ uppercase: !element.uppercase } as Partial<OverlayElement>)
          }
        >
          CAPS
        </Button>
        <Button
          variant={element.italic ? "solid" : "ghost"}
          onClick={() => update({ italic: !element.italic } as Partial<OverlayElement>)}
        >
          Italic
        </Button>
        <Button
          variant={element.shadow ? "solid" : "ghost"}
          onClick={() => update({ shadow: !element.shadow } as Partial<OverlayElement>)}
        >
          Shadow
        </Button>
      </div>
    </Section>
  );
}

/* ---------------------------------- image ---------------------------------- */

function ImageSection({ element }: { element: ImageElement }) {
  const update = useUpdate(element.id);
  return (
    <Section title="Picture">
      {element.prompt && (
        <p className="mb-2 rounded-lg bg-zinc-100 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
          {element.prompt}
        </p>
      )}
      <Row label="Fit">
        <Segmented
          value={element.fit}
          onChange={(fit) => update({ fit } as Partial<OverlayElement>)}
          options={[
            { value: "contain" as const, label: "Fit", title: "Show all of it" },
            { value: "cover" as const, label: "Fill", title: "Crop to the box" },
          ]}
        />
      </Row>
      <Row label="Corners">
        <Slider
          value={element.radius}
          min={0}
          max={0.5}
          step={0.01}
          onChange={(radius) => update({ radius } as Partial<OverlayElement>)}
        />
      </Row>
      <Button
        className="mt-1 w-full"
        variant={element.shadow ? "solid" : "ghost"}
        onClick={() => update({ shadow: !element.shadow } as Partial<OverlayElement>)}
      >
        Drop shadow
      </Button>
    </Section>
  );
}

/* ---------------------------------- shape ---------------------------------- */

function ShapeSection({ element }: { element: ShapeElement }) {
  const update = useUpdate(element.id);
  return (
    <Section title="Shape">
      <Row label="Kind">
        <Segmented
          value={element.shape}
          onChange={(shape) => update({ shape } as Partial<OverlayElement>)}
          options={[
            { value: "rect" as const, label: "Box" },
            { value: "ellipse" as const, label: "Oval" },
            { value: "line" as const, label: "Line" },
          ]}
        />
      </Row>
      <Row label="Fill">
        <ColorInput
          value={element.fill}
          allowNone
          onChange={(fill) => update({ fill } as Partial<OverlayElement>)}
        />
      </Row>
      <Row label="Stroke">
        <ColorInput
          value={element.strokeColor}
          allowNone
          onChange={(strokeColor) =>
            update({ strokeColor } as Partial<OverlayElement>)
          }
        />
      </Row>
      <Row label="Thickness">
        <Slider
          value={element.strokeWidth}
          min={0.001}
          max={0.03}
          step={0.001}
          onChange={(strokeWidth) =>
            update({ strokeWidth } as Partial<OverlayElement>)
          }
          format={(v) => v.toFixed(3)}
        />
      </Row>
      <Row label="Corners">
        <Slider
          value={element.radius}
          min={0}
          max={0.5}
          step={0.01}
          onChange={(radius) => update({ radius } as Partial<OverlayElement>)}
        />
      </Row>
    </Section>
  );
}

/* -------------------------------- placement -------------------------------- */

function PlacementSection({ element }: { element: OverlayElement }) {
  const update = useUpdate(element.id);
  // Presets are a request to be tidy, so they go through the placement rule
  // rather than writing the rect straight in.
  const place = useOverlayStore((s) => s.placeElement);
  return (
    <Section title="Placement">
      <div className="mb-2 grid grid-cols-3 gap-1">
        {(
          [
            "top-left",
            "top",
            "top-right",
            "left",
            "center",
            "right",
            "bottom-left",
            "bottom",
            "bottom-right",
          ] as const
        ).map((name) => (
          <button
            key={name}
            type="button"
            title={name}
            onClick={() =>
              place(element.id, rectAt(name, element.rect.w, element.rect.h))
            }
            className="flex h-7 cursor-pointer items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-400 transition hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
          >
            <span className="size-1.5 rounded-[2px] bg-current" />
          </button>
        ))}
      </div>
      <Row label="Preset">
        <Select
          value={"" as (typeof POSITIONS)[number] | ""}
          options={[
            { value: "" as (typeof POSITIONS)[number], label: "Snap to…" },
            ...POSITIONS.map((name) => ({ value: name, label: name })),
          ]}
          onChange={(name) => {
            if (!name) return;
            place(element.id, rectAt(name, element.rect.w, element.rect.h));
          }}
        />
      </Row>
      <Row label="Opacity">
        <Slider
          value={element.opacity}
          min={0}
          max={1}
          step={0.01}
          onChange={(opacity) => update({ opacity })}
        />
      </Row>
      <Row label="Rotation">
        <Slider
          value={element.rotation}
          min={-180}
          max={180}
          step={1}
          onChange={(rotation) => update({ rotation })}
          format={(v) => `${Math.round(v)}°`}
        />
      </Row>
    </Section>
  );
}

/* -------------------------------- animation -------------------------------- */

function AnimationSection({ element }: { element: OverlayElement }) {
  const update = useUpdate(element.id);

  const row = (
    which: "enter" | "exit",
    spec: AnimationSpec,
    label: string
  ) => (
    <div className="mb-3 last:mb-0">
      <p className="mb-1.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
        {label}
      </p>
      <Row label="Motion">
        <Select
          value={spec.kind}
          options={ANIMATION_KINDS.map((kind) => ({
            value: kind as AnimationKind,
            label: ANIMATION_LABELS[kind],
          }))}
          onChange={(kind) => update({ [which]: { ...spec, kind } })}
        />
      </Row>
      <Row label="Ease">
        <Select
          value={spec.easing}
          options={EASING_NAMES.map((name) => ({
            value: name as EasingName,
            label: name,
          }))}
          onChange={(easing) => update({ [which]: { ...spec, easing } })}
        />
      </Row>
      <Row label="Length">
        <Slider
          value={spec.duration}
          min={0.05}
          max={2}
          step={0.05}
          onChange={(duration) => update({ [which]: { ...spec, duration } })}
          format={(v) => `${v.toFixed(2)}s`}
        />
      </Row>
    </div>
  );

  return (
    <Section title="Animation">
      {row("enter", element.enter, "Coming in")}
      {row("exit", element.exit, "Going out")}
      <p className="mt-1 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">
        An animation never takes more than half the time the element is on
        screen, so a short caption still gets its full entrance.
      </p>
    </Section>
  );
}
