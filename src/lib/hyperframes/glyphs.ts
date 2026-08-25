/**
 * A vector icon, as it travels with a scene.
 *
 * Path data in Lucide's own 24x24 space. The catalogue is a third of a
 * megabyte and stays on the server; only the handful of paths a video actually
 * uses are sent to the browser, attached to the scene that asked for them.
 *
 * Declared on its own so a schema, a route and a canvas can all name the shape
 * without any of them importing the others.
 */
export interface Glyph {
  /** The Lucide name that won, for cache keys and for the editor to show. */
  name: string;
  /** The concept this was resolved from, so a re-resolve is idempotent. */
  query?: string;
  paths: string[];
}
