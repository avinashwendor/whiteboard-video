import {
  Image as ImageIcon,
  LayoutGrid,
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
  storyboard: {
    id: "storyboard",
    label: "Storyboard",
    blurb: "One brief, a board of frames",
    icon: LayoutGrid,
    accent: "var(--accent-story)",
    placeholder: "Storyboard a 60-second spot for a monsoon-season delivery app…",
    cta: "Board it out",
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

export const MODE_ORDER: Mode[] = ["create", "write", "image", "storyboard", "voice"];
