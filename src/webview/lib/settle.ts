/**
 * Settling a scroll to an edge of a virtualized list: rows above or below re-measure as they
 * render, so one scrollTo lands short. The list keeps re-asserting the edge each frame until the
 * position has stayed there for a few consecutive frames, or gives up after a cap.
 */
export interface Settle {
  /** Frames spent so far. */
  attempts: number;
  /** Consecutive frames found at the target. */
  stable: number;
  done: boolean;
}

export const SETTLE_START: Settle = { attempts: 0, stable: 0, done: false };
/** The position must be at the edge this many frames in a row. */
export const SETTLE_STABLE_FRAMES = 3;
/** Frames after which settling stops even if the edge was never stable. */
export const SETTLE_MAX_ATTEMPTS = 40;
/** scrollTop can land a fraction short of the end, which still counts as there. */
export const EDGE_TOLERANCE = 2;

/** The state after one more frame, given whether the list was at its target that frame. */
export function settleNext(s: Settle, atTarget: boolean): Settle {
  if (s.done) return s;
  const attempts = s.attempts + 1;
  const stable = atTarget ? s.stable + 1 : 0;
  return { attempts, stable, done: stable >= SETTLE_STABLE_FRAMES || attempts >= SETTLE_MAX_ATTEMPTS };
}

export function atTop(scrollTop: number): boolean {
  return scrollTop <= 0;
}

export function atBottom(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return scrollTop + clientHeight >= scrollHeight - EDGE_TOLERANCE;
}
