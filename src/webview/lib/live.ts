/**
 * What the message list does when turns arrive while it is open: follow the tail when the
 * reader was already at the bottom, otherwise count the arrivals into a "N new messages" pill.
 */
export interface PillDecision {
  /** Scroll to the bottom and keep it there. */
  follow: boolean;
  /** Count shown in the pill; 0 hides it. */
  pill: number;
}

export function newMessagesPill(prevPill: number, atBottom: boolean, added: number): PillDecision {
  if (atBottom) return { follow: true, pill: 0 };
  return { follow: false, pill: prevPill + Math.max(0, added) };
}

/** The pill clears itself once the reader reaches the bottom on their own. */
export function pillAfterScroll(pill: number, atBottom: boolean): number {
  return atBottom ? 0 : pill;
}

export function pillLabel(count: number): string {
  return `${count} new message${count === 1 ? "" : "s"}`;
}

/** A batch of turns that arrived after the first load; the seq changes per batch. */
export interface Appended {
  seq: number;
  /** New user and assistant messages in the batch. */
  added: number;
}
