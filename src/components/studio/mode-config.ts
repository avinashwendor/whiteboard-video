import { Image as ImageIcon, PenLine, Presentation, Volume2, type LucideIcon } from "lucide-react";
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
    label: "Write",
    blurb: "Scripts, stories and copy",
    icon: PenLine,
    accent: "var(--accent-write)",
    placeholder: "Write a 30-second advert for a student note-taking app…",
    cta: "Write it",
  },
  image: {
    id: "image",
    label: "Image",
    blurb: "One prompt, one visual",
    icon: ImageIcon,
    accent: "var(--accent-image)",
    placeholder: "A cinematic photo of Hyderabad at night, seen from a rooftop…",
    cta: "Generate image",
  },
  voice: {
    id: "voice",
    label: "Voice",
    blurb: "Natural narration",
    icon: Volume2,
    accent: "var(--accent-voice)",
    placeholder: "Paste the words you want spoken, in any supported language…",
    cta: "Speak it",
  },
  create: {
    id: "create",
    label: "Whiteboard",
    blurb: "A narrated explainer video",
    icon: Presentation,
    accent: "var(--accent-create)",
    placeholder: "Explain how compound interest works, for a 16-year-old…",
    cta: "Create the video",
  },
};

export const MODE_ORDER: Mode[] = ["create", "write", "image", "voice"];
