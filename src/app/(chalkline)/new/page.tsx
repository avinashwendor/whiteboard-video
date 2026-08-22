"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { StudioChat } from "@/components/studio/studio-chat";
import { useStudio } from "@/lib/studio/use-studio";

/**
 * The studio.
 *
 * Its own route rather than a sheet over the landing page: a production is the
 * thing you came to do, it survives a reload, and the URL is shareable — none
 * of which a modal gives you. `?style=hyperframes` preselects the engine so
 * the Hyperframes card on the landing page arrives already configured.
 */
export default function NewProductionPage() {
  return (
    <Suspense fallback={null}>
      <NewProduction />
    </Suspense>
  );
}

function NewProduction() {
  const { updateSettings, setMode } = useStudio();
  const params = useSearchParams();
  const style = params.get("style");
  const mode = params.get("mode");
  // Remounting is the reset: the thread lives in component state, so a new
  // token gives you an empty composer without a reducer or a context flag.
  const fresh = params.get("fresh");

  useEffect(() => {
    if (style === "hyperframes" || style === "whiteboard") {
      updateSettings({ videoStyle: style });
    }
  }, [style, updateSettings]);

  useEffect(() => {
    if (mode === "write" || mode === "image" || mode === "voice") {
      setMode(mode);
    }
  }, [mode, setMode]);

  return <StudioChat key={fresh ?? "thread"} />;
}
