"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { SceneSpec, SceneItem } from "@/lib/whiteboard/scene";
import { Label, TextInput } from "./controls";

/**
 * The words that are actually drawn.
 *
 * A whiteboard scene keeps two sets of text: the scene's own heading and
 * bullets, which the writer works from, and the composed board -- a title and
 * a handful of captions -- which is what ends up on the canvas. Editing the
 * first and watching nothing change is the single most confusing thing about
 * this editor, so the board is edited here, directly, in the order it is drawn.
 */

const COLOURS = ["blue", "yellow", "orange", "green", "red", "violet", "teal", "pink"] as const;
const BADGES = ["check", "cross", "alert"] as const;

type Item = SceneItem;

export function BoardEditor({
  spec,
  busy,
  onChange,
}: {
  spec: SceneSpec;
  busy: boolean;
  /** `iconsChanged` tells the caller the geometry has to be looked up again. */
  onChange: (next: SceneSpec, iconsChanged: boolean) => void;
}) {
  const patch = (changes: Partial<SceneSpec>, iconsChanged = false) => {
    onChange({ ...spec, ...changes } as SceneSpec, iconsChanged);
  };

  return (
    <div className="space-y-4">
      <label className="flex flex-col gap-1.5">
        <Label>Board title</Label>
        <TextInput
          value={spec.title}
          maxLength={42}
          onChange={(event) => patch({ title: event.target.value } as Partial<SceneSpec>)}
        />
        <span className="text-[10px] leading-relaxed text-faint">
          Drawn in capitals across the top. This is the title on the canvas.
        </span>
      </label>

      {"items" in spec && spec.items ? (
        <ItemList
          label={spec.layout === "steps" ? "Steps" : spec.layout === "timeline" ? "Points" : "Icons"}
          items={spec.items}
          busy={busy}
          min={spec.layout === "icons" ? 1 : 2}
          max={4}
          onChange={(items, iconsChanged) =>
            patch({ items } as unknown as Partial<SceneSpec>, iconsChanged)
          }
        />
      ) : null}

      {spec.layout === "stat" ? (
        <>
          <label className="flex flex-col gap-1.5">
            <Label>The number</Label>
            <TextInput
              value={spec.stat}
              maxLength={10}
              onChange={(event) => patch({ stat: event.target.value } as Partial<SceneSpec>)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <Label>Caption</Label>
            <TextInput
              value={spec.caption ?? ""}
              maxLength={30}
              onChange={(event) => patch({ caption: event.target.value } as Partial<SceneSpec>)}
            />
          </label>
          <IconField
            value={spec.icon ?? ""}
            busy={busy}
            onChange={(icon) => patch({ icon } as Partial<SceneSpec>, true)}
          />
        </>
      ) : null}

      {spec.layout === "pie" || spec.layout === "bars" ? (
        <DataList
          label={spec.layout === "pie" ? "Slices" : "Bars"}
          data={spec.data}
          max={spec.layout === "pie" ? 4 : 5}
          onChange={(data) => patch({ data } as unknown as Partial<SceneSpec>)}
        />
      ) : null}

      {spec.layout === "compare" ? (
        <>
          <Side
            label="Left side"
            side={spec.left}
            busy={busy}
            onChange={(left, iconsChanged) =>
              patch({ left } as unknown as Partial<SceneSpec>, iconsChanged)
            }
          />
          <Side
            label="Right side"
            side={spec.right}
            busy={busy}
            onChange={(right, iconsChanged) =>
              patch({ right } as unknown as Partial<SceneSpec>, iconsChanged)
            }
          />
        </>
      ) : null}
    </div>
  );
}

/* --------------------------------- pieces --------------------------------- */

function Side({
  label,
  side,
  busy,
  onChange,
}: {
  label: string;
  side: { title: string; items: Item[]; stat?: string; statCaption?: string };
  busy: boolean;
  onChange: (next: typeof side, iconsChanged: boolean) => void;
}) {
  return (
    <div className="space-y-2.5 rounded-lg border border-line bg-surface p-2.5">
      <Label>{label}</Label>
      <TextInput
        value={side.title}
        maxLength={24}
        placeholder="Column heading"
        onChange={(event) => onChange({ ...side, title: event.target.value }, false)}
      />
      <div className="grid grid-cols-2 gap-2">
        <TextInput
          value={side.stat ?? ""}
          maxLength={10}
          placeholder="Stat"
          onChange={(event) => onChange({ ...side, stat: event.target.value || undefined }, false)}
        />
        <TextInput
          value={side.statCaption ?? ""}
          maxLength={20}
          placeholder="Stat caption"
          onChange={(event) =>
            onChange({ ...side, statCaption: event.target.value || undefined }, false)
          }
        />
      </div>
      <ItemList
        label="Items"
        items={side.items}
        busy={busy}
        min={1}
        max={3}
        onChange={(items, iconsChanged) => onChange({ ...side, items }, iconsChanged)}
      />
    </div>
  );
}

function ItemList({
  label,
  items,
  busy,
  min,
  max,
  onChange,
}: {
  label: string;
  items: Item[];
  busy: boolean;
  min: number;
  max: number;
  onChange: (next: Item[], iconsChanged: boolean) => void;
}) {
  const set = (index: number, changes: Partial<Item>, iconsChanged = false) => {
    const next = items.map((item, i) => (i === index ? { ...item, ...changes } : item));
    onChange(next, iconsChanged);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {items.length < max ? (
          <button
            type="button"
            onClick={() => onChange([...items, { icon: "sparkles", label: "" }], true)}
            className="flex items-center gap-1 text-[10px] font-medium text-muted transition-colors hover:text-ink"
          >
            <Plus className="size-3" aria-hidden />
            Add
          </button>
        ) : null}
      </div>

      {items.map((item, index) => (
        <div key={index} className="space-y-1.5 rounded-lg border border-line bg-surface-raised p-2">
          <div className="flex items-center gap-1.5">
            <span className="w-4 shrink-0 text-center font-mono text-[10px] text-faint">
              {index + 1}
            </span>
            <TextInput
              value={item.label ?? ""}
              maxLength={20}
              placeholder="Caption"
              onChange={(event) => set(index, { label: event.target.value })}
            />
            {items.length > min ? (
              <button
                type="button"
                aria-label={`Remove item ${index + 1}`}
                onClick={() => onChange(items.filter((_, i) => i !== index), true)}
                className="shrink-0 text-faint transition-colors hover:text-danger"
              >
                <Trash2 className="size-3" aria-hidden />
              </button>
            ) : null}
          </div>

          <div className="pl-[22px]">
            <IconField
              value={item.icon}
              busy={busy}
              onChange={(icon) => set(index, { icon }, true)}
            />
          </div>

          <div className="flex flex-wrap gap-1 pl-[22px]">
            {BADGES.map((badge) => (
              <Chip
                key={badge}
                active={item.badge === badge}
                onClick={() => set(index, { badge: item.badge === badge ? undefined : badge })}
              >
                {badge}
              </Chip>
            ))}
            {COLOURS.map((colour) => (
              <button
                key={colour}
                type="button"
                title={colour}
                aria-label={colour}
                onClick={() => set(index, { colour: item.colour === colour ? undefined : colour })}
                className={cn(
                  "size-4 rounded-full border transition-transform",
                  item.colour === colour ? "scale-110 border-ink" : "border-line",
                )}
                style={{ background: SWATCH[colour] }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const SWATCH: Record<(typeof COLOURS)[number], string> = {
  blue: "#5b9bd5",
  yellow: "#f2c94c",
  orange: "#f2994a",
  green: "#6fcf97",
  red: "#eb5757",
  violet: "#9b8cf2",
  teal: "#4fc3c7",
  pink: "#f28ab2",
};

function DataList({
  label,
  data,
  max,
  onChange,
}: {
  label: string;
  data: Array<{ label: string; value: number; colour?: string }>;
  max: number;
  onChange: (next: Array<{ label: string; value: number; colour?: string }>) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {data.length < max ? (
          <button
            type="button"
            onClick={() => onChange([...data, { label: "", value: 10 }])}
            className="flex items-center gap-1 text-[10px] font-medium text-muted transition-colors hover:text-ink"
          >
            <Plus className="size-3" aria-hidden />
            Add
          </button>
        ) : null}
      </div>
      {data.map((entry, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <TextInput
            value={entry.label}
            maxLength={24}
            placeholder="Label"
            onChange={(event) =>
              onChange(data.map((d, i) => (i === index ? { ...d, label: event.target.value } : d)))
            }
          />
          <input
            type="number"
            value={entry.value}
            min={0}
            className="h-8 w-20 shrink-0 rounded-lg border border-line bg-surface-raised px-2 text-[12px] text-ink outline-none transition-colors hover:border-line-strong focus:border-line-strong"
            onChange={(event) =>
              onChange(
                data.map((d, i) =>
                  i === index ? { ...d, value: Number(event.target.value) || 0 } : d,
                ),
              )
            }
          />
          {data.length > 2 ? (
            <button
              type="button"
              aria-label={`Remove ${label} ${index + 1}`}
              onClick={() => onChange(data.filter((_, i) => i !== index))}
              className="shrink-0 text-faint transition-colors hover:text-danger"
            >
              <Trash2 className="size-3" aria-hidden />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * An icon is named, not drawn. The name is matched against the hand-drawn set
 * first and a 1700-icon catalogue after that, so a plain noun works better than
 * an abstraction -- "banknote" over "finance".
 */
function IconField({
  value,
  busy,
  onChange,
}: {
  value: string;
  busy: boolean;
  onChange: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  // The resolver has the last word: "stopwatch" may come back as "timer", and a
  // relayout replaces the icon outright. Either way the field has to show what
  // the board is actually drawing, not what was typed at it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirroring the resolved name
    setDraft(value);
  }, [value]);

  return (
    <label className="flex items-center gap-1.5">
      <span className="shrink-0 text-[10px] text-faint">icon</span>
      <TextInput
        value={draft}
        maxLength={40}
        placeholder="server, brain, handshake…"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const name = draft.trim().toLowerCase();
          if (name && name !== value) onChange(name);
          else setDraft(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      {busy ? <Loader2 className="size-3 shrink-0 animate-spin text-faint" aria-hidden /> : null}
    </label>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-1.5 py-0.5 text-[10px] transition-colors",
        active
          ? "border-line-strong bg-surface-hover text-ink"
          : "border-line bg-surface text-faint hover:text-muted",
      )}
    >
      {children}
    </button>
  );
}
