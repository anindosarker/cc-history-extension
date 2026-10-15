/** Where the Messages list is scrolled when a session opens. */
export type OpenAt = "oldest" | "newest";

export const DEFAULT_OPEN_AT: OpenAt = "oldest";

export function normalizeOpenAt(v: unknown): OpenAt {
  return v === "newest" ? "newest" : DEFAULT_OPEN_AT;
}
