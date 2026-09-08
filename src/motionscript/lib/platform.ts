export const isElectron =
  typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent);

/**
 * Which desktop the app is running on.
 *
 * The download banner this once fed is gone — there is no MotionScript
 * desktop build to pitch — but the detection still drives keyboard hints and
 * the Electron menu, so it stays.
 */
export type Platform =
  | "mac-arm"
  | "mac-intel"
  | "windows"
  | "linux"
  | "mobile"
  | "unknown";

/** Phones and tablets, including iPadOS, which reports a desktop Mac UA. */
function isMobile(ua: string): boolean {
  if (/android|iphone|ipod|ipad|windows phone|mobile/.test(ua)) return true;
  // iPadOS 13+ masquerades as macOS; a touch-capable "Mac" is really an iPad.
  return (
    ua.includes("mac") &&
    typeof navigator !== "undefined" &&
    navigator.maxTouchPoints > 1
  );
}

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator.platform || "").toLowerCase();

  if (isMobile(ua)) return "mobile";
  if (ua.includes("win") || platform.includes("win")) return "windows";
  if (ua.includes("linux") || platform.includes("linux")) return "linux";
  if (ua.includes("mac") || platform.includes("mac")) {
    // Apple Silicon is the common default for recent Macs; the download page
    // offers Intel as the alternate.
    return "mac-arm";
  }
  return "unknown";
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  "mac-arm": "Mac",
  "mac-intel": "Mac",
  windows: "Windows",
  linux: "Linux",
  mobile: "",
  unknown: "",
};
