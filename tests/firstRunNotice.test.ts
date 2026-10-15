import { describe, expect, it } from "vitest";
import { shouldShowFirstRunNotice } from "../src/extension/firstRunNotice";

describe("first-run notice decision", () => {
  it("shows on the first activation when the usage widget is on", () => {
    expect(shouldShowFirstRunNotice({ alreadyShown: false, usageEnabled: true })).toBe(true);
  });

  it("never shows again once the flag is set", () => {
    expect(shouldShowFirstRunNotice({ alreadyShown: true, usageEnabled: true })).toBe(false);
    expect(shouldShowFirstRunNotice({ alreadyShown: true, usageEnabled: false })).toBe(false);
  });

  it("skips the notice when the usage widget is already off", () => {
    expect(shouldShowFirstRunNotice({ alreadyShown: false, usageEnabled: false })).toBe(false);
  });

  it("shows exactly once across a sequence of activations", () => {
    let alreadyShown = false;
    let shown = 0;
    for (let i = 0; i < 3; i++) {
      if (shouldShowFirstRunNotice({ alreadyShown, usageEnabled: true })) {
        alreadyShown = true; // the host sets the flag before showing the message
        shown++;
      }
    }
    expect(shown).toBe(1);
  });
});
