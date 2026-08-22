import {
  Image as ImageIcon,
  PenLine,
  Presentation,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import type { Mode } from "@/lib/studio/types";

export interface ModeConfig {
  id: Mode;
  label: string;
  blurb: string;
  icon: LucideIcon;
  /** CSS colour token used for the accent dot and active state. */
  accent: string;
  placeholder: string;
  cta: string;
}

export const MODE_CONFIG: Record<Mode, ModeConfig> = {
  write: {
    id: "write",
    label: "Script",
    blurb: "Scripts, stories and copy",
    icon: PenLine,
    accent: "var(--accent-write)",
    placeholder: "Write a 30-second advert for a student note-taking app…",
    cta: "Write the script",
  },
  image: {
    id: "image",
    label: "Still",
    blurb: "One prompt, one frame",
    icon: ImageIcon,
    accent: "var(--accent-image)",
    placeholder: "A cinematic still of Hyderabad at night, seen from a rooftop…",
    cta: "Make the still",
  },
  voice: {
    id: "voice",
    label: "Voiceover",
    blurb: "Natural narration",
    icon: Volume2,
    accent: "var(--accent-voice)",
    placeholder: "Paste the words you want spoken, in any supported language…",
    cta: "Record the take",
  },
  create: {
    id: "create",
    label: "Video",
    blurb: "A narrated explainer video",
    icon: Presentation,
    accent: "var(--accent-create)",
    placeholder: "Explain how compound interest works, for a 16-year-old…",
    cta: "Create the video",
  },
};

export const MODE_ORDER: Mode[] = ["create", "write", "image", "voice"];

/**
 * Looks up a mode that may not exist any more.
 *
 * History is persisted, so it outlives the mode list. Retiring `storyboard`
 * left every board already on disk pointing at a config that had gone, and
 * indexing straight into the record took the History page down with it.
 * Anything unrecognised falls back rather than throwing.
 */
export function configFor(mode: string): ModeConfig {
  return MODE_CONFIG[mode as Mode] ?? MODE_CONFIG.create;
}
