import { describe, expect, it } from "vitest";
import { normalizeOpenAt } from "../src/shared/openAt";

describe("openAt setting", () => {
  it("accepts only the two known values and defaults to oldest", () => {
    expect(normalizeOpenAt("newest")).toBe("newest");
    expect(normalizeOpenAt("oldest")).toBe("oldest");
    expect(normalizeOpenAt("latest")).toBe("oldest");
    expect(normalizeOpenAt(undefined)).toBe("oldest");
    expect(normalizeOpenAt(42)).toBe("oldest");
  });
});
