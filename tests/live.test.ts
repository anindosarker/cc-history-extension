import { describe, expect, it } from "vitest";
import { newMessagesPill, pillAfterScroll, pillLabel } from "../src/webview/lib/live";

describe("new messages pill", () => {
  it("follows the tail when the reader was at the bottom", () => {
    expect(newMessagesPill(0, true, 3)).toEqual({ follow: true, pill: 0 });
    expect(newMessagesPill(4, true, 1)).toEqual({ follow: true, pill: 0 });
  });

  it("counts arrivals into the pill when the reader scrolled up, and never below zero", () => {
    expect(newMessagesPill(0, false, 2)).toEqual({ follow: false, pill: 2 });
    expect(newMessagesPill(2, false, 3)).toEqual({ follow: false, pill: 5 });
    expect(newMessagesPill(2, false, 0)).toEqual({ follow: false, pill: 2 });
    expect(newMessagesPill(2, false, -1)).toEqual({ follow: false, pill: 2 });
  });

  it("clears once the reader reaches the bottom on their own", () => {
    expect(pillAfterScroll(5, true)).toBe(0);
    expect(pillAfterScroll(5, false)).toBe(5);
  });

  it("labels the count", () => {
    expect(pillLabel(1)).toBe("1 new message");
    expect(pillLabel(7)).toBe("7 new messages");
  });
});
