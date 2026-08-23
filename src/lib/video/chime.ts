"use client";

/**
 * The "it's ready" sound.
 *
 * Synthesised for the same reason everything else here is: nothing to license,
 * nothing to download, and it can be tuned by editing two numbers. A rising
 * perfect fifth on soft sines — short, quiet, and nothing like a notification
 * from an operating system, because you will hear it every time a video lands
 * and an abrasive one gets muted within the hour.
 *
 * Only plays when the tab is hidden. If you are watching the screen you have
 * already seen it finish, and a sound you did not need is noise.
 */

const STORAGE_KEY = "motionhouse:chime";

export function chimeEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(STORAGE_KEY) !== "off";
}

export function setChimeEnabled(on: boolean) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
}

export function playReadyChime() {
  if (typeof window === "undefined") return;
  if (!chimeEnabled()) return;

  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    const now = ctx.currentTime + 0.02;

    // D5, then A5 a beat later. Consonant, so it reads as "done" rather than
    // as an alarm.
    for (const [index, frequency] of [587.33, 880].entries()) {
      const at = now + index * 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.value = frequency;

      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.55);
    }

    // Let the tail finish, then release the hardware.
    setTimeout(() => void ctx.close().catch(() => {}), 1_200);
  } catch {
    // No audio context is not worth a broken generation.
  }
}
