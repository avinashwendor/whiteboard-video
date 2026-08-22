"use client";

import { useEffect, useState } from "react";

/**
 * Decodes every picture up front. The canvas cannot draw a half-loaded image,
 * and loading one mid-playback would stutter the preview and the recording
 * alike.
 *
 * Two rules learned the hard way. A picture that has loaded is never thrown
 * away for being slow -- an earlier version raced `decode()` against a 2.5s
 * timer and discarded the winner's work, and because board preparation blocks
 * the main thread for a moment, the timer usually won and every photograph
 * silently vanished from the video. And results are published as they arrive,
 * so one stalled URL cannot hold up the rest.
 */
export function useBoardImages(urls: Array<string | undefined>): {
  images: Array<HTMLImageElement | null>;
  ready: boolean;
} {
  const key = urls.join("|");
  const [state, setState] = useState<{ images: Array<HTMLImageElement | null>; ready: boolean }>({
    images: urls.map(() => null),
    ready: false,
  });

  useEffect(() => {
    let cancelled = false;
    const list = key ? key.split("|") : [];
    const loaded: Array<HTMLImageElement | null> = list.map(() => null);

    let pending = list.filter(Boolean).length;
    if (!pending) {
      // Deferred by a tick: settling state inside the effect body is the
      // cascading-render the lint rule guards against.
      const idle = setTimeout(() => {
        if (!cancelled) setState({ images: loaded, ready: true });
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(idle);
      };
    }

    // A backstop only: it lets playback begin, and any picture that arrives
    // afterwards is still published.
    const timer = setTimeout(() => {
      if (!cancelled) setState((previous) => ({ ...previous, ready: true }));
    }, 8_000);

    list.forEach((url, index) => {
      if (!url) return;
      const image = new Image();
      if (!url.startsWith("blob:") && !url.startsWith("data:")) image.crossOrigin = "anonymous";

      const settle = (ok: boolean) => {
        if (cancelled) return;
        if (ok) loaded[index] = image;
        pending -= 1;
        setState({ images: [...loaded], ready: pending <= 0 });
        if (pending <= 0) clearTimeout(timer);
      };

      image.onload = () => settle(image.naturalWidth > 0);
      image.onerror = () => settle(false);
      image.src = url;
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);

  return state;
}
