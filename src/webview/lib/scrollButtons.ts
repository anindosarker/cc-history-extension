/** Which of the two scroll buttons should render for a given scroll position. */
export interface ScrollButtons {
  up: boolean;
  down: boolean;
}

/** Tolerance for "at the edge", since scrollTop can land a fraction short of the end. */
const EDGE = 2;

/**
 * Nothing when the content fits; only "down" at the top, only "up" at the end, both in between.
 */
export function scrollButtonsFor(scrollTop: number, scrollHeight: number, clientHeight: number): ScrollButtons {
  if (scrollHeight <= clientHeight + EDGE) return { up: false, down: false };
  const atTop = scrollTop <= EDGE;
  const atEnd = scrollTop + clientHeight >= scrollHeight - EDGE;
  return { up: !atTop, down: !atEnd };
}

/** How close (in px) the pointer must be to the bottom-right corner for the buttons to show. */
export const CORNER_RADIUS = 96;

/** True when a pointer at (x, y) is within CORNER_RADIUS of the viewport's bottom-right corner. */
export function nearBottomRight(x: number, y: number, rect: { right: number; bottom: number }): boolean {
  const dx = Math.max(0, rect.right - x);
  const dy = Math.max(0, rect.bottom - y);
  return dx <= CORNER_RADIUS && dy <= CORNER_RADIUS;
}
