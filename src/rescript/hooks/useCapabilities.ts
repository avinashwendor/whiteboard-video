"use client";

import { useEffect, useState } from "react";
import type { SlashCapabilities } from "@/rescript/lib/slash";

/**
 * What this deployment can actually reach, asked once per page.
 *
 * Every panel that offers to fetch something needs the same answer, and the
 * answer never changes while the tab is open — it is a property of the server's
 * environment, not of the project. So the request is made once and shared,
 * rather than each panel discovering the same thing on mount.
 *
 * Optimistic while it is in flight. A menu that hides half its commands for the
 * first second after opening reads as broken, and the cost of being wrong is an
 * operation that comes back saying the catalogue is not configured — which is
 * exactly the message it would have shown anyway.
 */

const OPTIMISTIC: SlashCapabilities = {
  image: true,
  video: true,
  sfx: true,
  music: true,
};

let cached: SlashCapabilities | null = null;
let inFlight: Promise<SlashCapabilities> | null = null;

interface CapabilitiesResponse {
  image?: { providers?: Array<{ id: string; configured?: boolean }> };
  visual?: { configured?: boolean };
  media?: { kinds?: Record<string, boolean> };
}

function read(json: CapabilitiesResponse): SlashCapabilities {
  const kinds = json.media?.kinds ?? {};
  const generators = json.image?.providers ?? [];
  return {
    // A picture can come from a generator or from a photo search; either is
    // enough for the command to be worth offering.
    image:
      Boolean(kinds.image) ||
      Boolean(json.visual?.configured) ||
      generators.some((p) => p.configured !== false),
    video: Boolean(kinds.video),
    sfx: Boolean(kinds.sfx),
    music: Boolean(kinds.music),
  };
}

export function fetchCapabilities(): Promise<SlashCapabilities> {
  if (cached) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = fetch("/api/capabilities")
      .then((r) => r.json())
      .then((json: CapabilitiesResponse) => {
        cached = read(json);
        return cached;
      })
      .catch(() => {
        // Offline, or the route is down. Offer everything and let the
        // individual operation report what went wrong.
        inFlight = null;
        return OPTIMISTIC;
      });
  }
  return inFlight;
}

export function useCapabilities(): SlashCapabilities {
  const [can, setCan] = useState<SlashCapabilities>(cached ?? OPTIMISTIC);
  useEffect(() => {
    let alive = true;
    void fetchCapabilities().then((next) => {
      if (alive) setCan(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return can;
}
