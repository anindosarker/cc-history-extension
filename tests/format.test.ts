import { describe, expect, it } from "vitest";
import { formatClock, formatDayLabel, formatFullDateTime, formatHumanDate, formatHumanDateTime } from "../src/shared/time";
import * as webviewFormat from "../src/webview/lib/format";
import * as hostTime from "../src/extension/time";

// Local times, so the expectations hold in any zone.
const SEP_29_2026 = new Date(2026, 8, 29, 22, 51, 7).getTime();
const IN_2026 = new Date(2026, 0, 5, 9, 0).getTime();
const IN_2027 = new Date(2027, 0, 5, 9, 0).getTime();

describe("clock formatting", () => {
  it("uses the 12 hour clock in en-US and the 24 hour clock in de-DE", () => {
    expect(formatClock(SEP_29_2026, { locale: "en-US" })).toBe("10:51 PM");
    expect(formatClock(SEP_29_2026, { locale: "de-DE" })).toBe("22:51");
    expect(formatClock(new Date(2026, 8, 29, 9, 5).getTime(), { locale: "en-US" })).toBe("9:05 AM");
    expect(formatClock(new Date(2026, 8, 29, 9, 5).getTime(), { locale: "de-DE" })).toBe("09:05");
  });

  it("falls back to the default locale on an invalid tag", () => {
    expect(formatClock(SEP_29_2026, { locale: "nope!!" })).toBe(formatClock(SEP_29_2026));
  });
});

describe("human date formatting", () => {
  it("drops the year inside the current year and keeps it otherwise", () => {
    expect(formatHumanDateTime(SEP_29_2026, { now: IN_2026, locale: "en-US" })).toBe("Sep 29 · 10:51 PM");
    expect(formatHumanDateTime(SEP_29_2026, { now: IN_2027, locale: "en-US" })).toBe("Sep 29, 2026 · 10:51 PM");
    expect(formatHumanDate(SEP_29_2026, { now: IN_2026, locale: "en-US" })).toBe("Sep 29");
    expect(formatHumanDate(SEP_29_2026, { now: IN_2027, locale: "en-US" })).toBe("Sep 29, 2026");
  });

  it("takes the clock style from the locale", () => {
    const de = formatHumanDateTime(SEP_29_2026, { now: IN_2027, locale: "de-DE" });
    expect(de).toContain("22:51");
    expect(de).toContain("2026");
    expect(de).not.toMatch(/PM/);
    expect(formatHumanDateTime(SEP_29_2026, { now: IN_2027, locale: "en-GB" })).toMatch(/^29 Sept? 2026 · 22:51$/);
  });

  it("falls back to the default locale on an invalid tag instead of throwing", () => {
    const bad = formatHumanDateTime(SEP_29_2026, { now: IN_2027, locale: "not a locale!!" });
    expect(bad).toBe(formatHumanDateTime(SEP_29_2026, { now: IN_2027 }));
    expect(bad).toMatch(/29/);
    expect(bad).toContain(" · ");
  });

  it("writes the full form with weekday and seconds for tooltips", () => {
    expect(formatFullDateTime(SEP_29_2026, { locale: "en-US" })).toBe("Tue, Sep 29, 2026 · 10:51:07 PM");
    expect(formatFullDateTime(SEP_29_2026, { locale: "de-DE" })).toContain("22:51:07");
  });

  it("labels date dividers with the weekday and the day", () => {
    expect(formatDayLabel(SEP_29_2026, { locale: "en-US" })).toBe("Tue, Sep 29");
    expect(formatDayLabel(SEP_29_2026, { locale: "de-DE" })).toMatch(/^Di\.?,? 29\. Sept?\.?$/);
  });

  it("is the same code on the host and in the webview", () => {
    expect(webviewFormat.formatClock).toBe(formatClock);
    expect(webviewFormat.formatHumanDateTime).toBe(formatHumanDateTime);
    expect(webviewFormat.formatFullDateTime).toBe(formatFullDateTime);
    expect(webviewFormat.formatDayLabel).toBe(formatDayLabel);
    expect(hostTime.formatClock).toBe(formatClock);
    expect(hostTime.formatHumanDateTime).toBe(formatHumanDateTime);
    expect(hostTime.formatFullDateTime).toBe(formatFullDateTime);
  });
});
