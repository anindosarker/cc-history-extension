import { describe, expect, it } from "vitest";
import { atBottom, atTop, SETTLE_MAX_ATTEMPTS, SETTLE_STABLE_FRAMES, SETTLE_START, settleNext } from "../src/webview/lib/settle";

describe("scroll settle helper", () => {
  it("finishes after three consecutive frames at the target", () => {
    let s = SETTLE_START;
    s = settleNext(s, true);
    s = settleNext(s, true);
    expect(s).toEqual({ attempts: 2, stable: 2, done: false });
    s = settleNext(s, true);
    expect(s).toEqual({ attempts: 3, stable: SETTLE_STABLE_FRAMES, done: true });
  });

  it("restarts the stable count whenever a frame lands off target", () => {
    let s = SETTLE_START;
    s = settleNext(s, true);
    s = settleNext(s, true);
    s = settleNext(s, false);
    expect(s).toEqual({ attempts: 3, stable: 0, done: false });
    s = settleNext(s, true);
    s = settleNext(s, true);
    expect(s.done).toBe(false);
    s = settleNext(s, true);
    expect(s).toEqual({ attempts: 6, stable: 3, done: true });
  });

  it("gives up at the attempt cap and then stays done", () => {
    let s = SETTLE_START;
    for (let i = 0; i < SETTLE_MAX_ATTEMPTS - 1; i++) s = settleNext(s, false);
    expect(s).toEqual({ attempts: SETTLE_MAX_ATTEMPTS - 1, stable: 0, done: false });
    s = settleNext(s, false);
    expect(s).toEqual({ attempts: SETTLE_MAX_ATTEMPTS, stable: 0, done: true });
    expect(settleNext(s, true)).toBe(s);
  });

  it("knows the edges, allowing a fractional shortfall at the bottom only", () => {
    expect(atTop(0)).toBe(true);
    expect(atTop(-0.5)).toBe(true);
    expect(atTop(1)).toBe(false);
    expect(atBottom(1400, 600, 2000)).toBe(true);
    expect(atBottom(1398.5, 600, 2000)).toBe(true);
    expect(atBottom(1397, 600, 2000)).toBe(false);
  });
});
