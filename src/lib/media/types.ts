/**
 * Stock media: music, sound effects, pictures and loops.
 *
 * One contract for every catalogue, for the same reason the text, image and
 * speech providers have one: the panel that searches and the agent that plans
 * should not know which service answered, and swapping a paid catalogue in
 * later should be one file rather than a refactor.
 *
 * ## On YouTube
 *
 * There is no provider here that reads YouTube, and there will not be. Its Data
 * API has no audio-download endpoint, extracting audio breaches its Terms, and
 * nearly all music on it is licensed such that putting it in an exported video
 * gets the person who uploads that video a copyright claim. A tool that shipped
 * it would be handing every one of its users a strike. The catalogues below are
 * the ones that solve the actual problem — music you are allowed to publish.
 */

export type MediaKind = "music" | "sfx" | "image" | "gif";

/**
 * What a licence obliges, reduced to the two questions that change behaviour.
 *
 * Not the licence text: nobody reads it and no code can act on it. These two
 * booleans are what decides whether the app has to print a credit and whether a
 * result may be offered to someone making something commercial.
 */
export interface MediaLicence {
  /** As published, e.g. "CC BY 4.0", "Pixabay Content Licence". */
  name: string;
  attributionRequired: boolean;
  /** False for the "non-commercial" and "no derivatives" variants. */
  commercialUse: boolean;
  url?: string;
}

export interface MediaResult {
  /** Stable within a provider. Not globally unique — pair it with `provider`. */
  id: string;
  provider: string;
  kind: MediaKind;
  title: string;
  /** Whoever the credit belongs to. */
  artist: string;
  /**
   * Where the actual bytes are, at the provider.
   *
   * Never handed to the browser as-is: the editor is cross-origin isolated, a
   * cross-origin picture taints the canvas, and cross-origin audio cannot be
   * read into the mix. Everything is proxied through `/api/asset` first.
   */
  downloadUrl: string;
  /** A small preview — a waveform image, a thumbnail, a short clip. */
  previewUrl?: string;
  /** Seconds. Absent for pictures. */
  duration?: number;
  licence: MediaLicence;
  /** The page a credit should link to. */
  pageUrl?: string;
  tags?: string[];
}

export interface MediaSearch {
  query: string;
  kind: MediaKind;
  /** Cap. Providers may return fewer. */
  limit?: number;
  /**
   * Only results that may be used commercially.
   *
   * Defaults to true, and that default is the point: someone editing a client
   * video should not have to know that a licence filter exists in order to
   * avoid using something they are not allowed to. Making it opt-*out* means
   * the failure mode is "fewer results" rather than "a legal problem later".
   */
  commercialOnly?: boolean;
  signal?: AbortSignal;
}

export interface MediaProvider {
  readonly id: string;
  /** What this catalogue can answer for. */
  readonly kinds: readonly MediaKind[];
  /** False when it needs a key the deployment has not been given. */
  isConfigured(): boolean;
  /** True when it works with no key at all — the out-of-the-box path. */
  readonly keyless: boolean;
  /** One line for the UI, explaining what this catalogue is. */
  readonly note: string;
  search(input: MediaSearch): Promise<MediaResult[]>;
}

/** Everything a clip needs to carry its credit, from a result. */
export function creditFrom(result: MediaResult) {
  return {
    title: result.title,
    artist: result.artist,
    licence: result.licence.name,
    url: result.pageUrl,
    attributionRequired: result.licence.attributionRequired,
  };
}

/**
 * Read a Creative Commons licence code into the two questions that matter.
 *
 * The codes are a small closed set and the rules are mechanical: `nc` forbids
 * commercial use, `nd` forbids the derivative that putting a track under a
 * video *is*, and everything except CC0 and the public-domain marks wants a
 * credit. Worth doing properly rather than showing everything and hoping.
 */
export function readCcLicence(code: string, version = ""): MediaLicence {
  const key = code.trim().toLowerCase();
  const label = version ? `${key.toUpperCase()} ${version}` : key.toUpperCase();

  if (key === "cc0" || key === "pdm") {
    return {
      name: key === "cc0" ? "CC0" : "Public domain",
      attributionRequired: false,
      commercialUse: true,
    };
  }

  return {
    name: `CC ${label}`,
    attributionRequired: true,
    // `nd` matters as much as `nc` here: a no-derivatives track cannot legally
    // be cut, faded or mixed under speech, which is the only thing this editor
    // would do with it.
    commercialUse: !key.includes("nc") && !key.includes("nd"),
  };
}
