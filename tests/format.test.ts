import { describe, expect, it } from "vitest";
import { formatFullDateTime, formatHumanDateTime } from "../src/webview/lib/format";

// Local times, so the expectations hold in any zone.
const SEP_29_2026 = new Date(2026, 8, 29, 22, 51, 7).getTime();
const IN_2026 = new Date(2026, 0, 5, 9, 0).getTime();
const IN_2027 = new Date(2027, 0, 5, 9, 0).getTime();

describe("human date formatting", () => {
  it("drops the year inside the current year and keeps it otherwise", () => {
    expect(formatHumanDateTime(SEP_29_2026, { now: IN_2026, locale: "en-US" })).toBe("Sep 29 · 10:51 PM");
    expect(formatHumanDateTime(SEP_29_2026, { now: IN_2027, locale: "en-US" })).toBe("Sep 29, 2026 · 10:51 PM");
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
});
