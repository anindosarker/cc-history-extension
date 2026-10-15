import { describe, expect, it } from "vitest";
import { computeStatus } from "../src/extension/liveStatus";

const now = 1_000_000_000;
const min = 60_000;

describe("live status rules", () => {
  it("is running when the pid is alive and the log changed within two minutes", () => {
    expect(computeStatus({ alive: true, mtime: now - 30_000, now })).toBe("running");
    expect(computeStatus({ alive: true, mtime: now - 2 * min, now })).toBe("running");
  });

  it("is open when the pid is alive but idle", () => {
    expect(computeStatus({ alive: true, mtime: now - 2 * min - 1, now })).toBe("open");
    expect(computeStatus({ alive: true, mtime: now - 60 * min, now })).toBe("open");
  });

  it("is ended recently when no pid is alive but the log changed within ten minutes", () => {
    expect(computeStatus({ alive: false, mtime: now - 3 * min, now })).toBe("ended");
    expect(computeStatus({ alive: false, mtime: now - 10 * min, now })).toBe("ended");
  });

  it("has no status for old sessions without a process", () => {
    expect(computeStatus({ alive: false, mtime: now - 10 * min - 1, now })).toBeUndefined();
    expect(computeStatus({ alive: false, mtime: 0, now })).toBeUndefined();
  });
});
