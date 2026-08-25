"use client";

/**
 * The "it's ready" sound.
 *
 * Synthesised for the same reason everything else here is: nothing to license,
 * nothing to download, and it can be tuned by editing two numbers. Two low
 * knocks — short, quiet, and well under the register a voice occupies, because
 * you will hear it every time a video lands and anything that rings gets muted
 * within the hour.
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

    // Two low knocks rather than a rising fifth on sines.
    //
    // The bell version was the right shape and the wrong register: a bright
    // tone with half a second of decay is a notification, and a notification
    // you hear every time a video lands is a notification you mute. This sits
    // under the voice register, is over in a fifth of a second, and reads as
    // "done" because of its rhythm rather than its pitch.
    for (const [index, frequency] of [196, 146.83].entries()) {
      const at = now + index * 0.11;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const low = ctx.createBiquadFilter();

      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, at);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.6, at + 0.12);
      low.type = "lowpass";
      low.frequency.value = 700;

      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(index === 0 ? 0.1 : 0.13, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);

      osc.connect(low).connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.24);
    }

    // Let the tail finish, then release the hardware.
    setTimeout(() => void ctx.close().catch(() => {}), 1_200);
  } catch {
    // No audio context is not worth a broken generation.
  }
}
