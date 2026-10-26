import { describe, expect, it } from "vitest";
import { foregroundFor, resolveThemeTokens, rulesOf, scopeMatches, type TokenColorRule } from "../src/extension/themeColors";

const rule = (scope: string | string[], foreground: string): TokenColorRule => ({ scope, settings: { foreground } });

describe("scope matching", () => {
  it("matches a selector against the scope itself and its children only", () => {
    expect(scopeMatches("string", "string")).toBe(true);
    expect(scopeMatches("string", "string.quoted.double")).toBe(true);
    expect(scopeMatches("string.quoted", "string.quoted.double")).toBe(true);
    expect(scopeMatches("str", "string.quoted.double")).toBe(false);
    expect(scopeMatches("string.regexp", "string.quoted.double")).toBe(false);
  });

  it("prefers the longest matching selector, then the later rule", () => {
    const rules = [rule("string.quoted", "#111111"), rule("string", "#222222")];
    expect(foregroundFor(rules, "string.quoted.double")).toBe("#111111");
    expect(foregroundFor([...rules, rule("string.quoted", "#333333")], "string.quoted.double")).toBe("#333333");
    expect(foregroundFor(rules, "constant.numeric")).toBeUndefined();
  });

  it("splits comma scopes and arrays, and skips descendant, exclusion and non-hex rules", () => {
    expect(foregroundFor([rule("comment, string", "#123456")], "string.quoted.double")).toBe("#123456");
    expect(foregroundFor([rule(["keyword", "storage, comment.line"], "#abcdef")], "comment.line")).toBe("#abcdef");
    expect(foregroundFor([rule("source.js string", "#111111")], "string.quoted.double")).toBeUndefined();
    expect(foregroundFor([rule("keyword - keyword.operator", "#111111")], "keyword.control")).toBeUndefined();
    expect(foregroundFor([rule("string", "red; x")], "string.quoted.double")).toBeUndefined();
    expect(foregroundFor([{ scope: "string", settings: {} }], "string.quoted.double")).toBeUndefined();
  });
});

describe("theme token resolution", () => {
  it("lets included files lose to the files that include them", () => {
    const parent = [rule("keyword", "#000001"), rule("string", "#000002"), rule("comment", "#000003")];
    const child = [rule("keyword", "#100001"), rule("string.quoted.double", "#100002")];
    const colors = resolveThemeTokens([parent, child], undefined, "Child");
    expect(colors.keyword).toBe("#100001");
    expect(colors.string).toBe("#100002");
    expect(colors.comment).toBe("#000003");
  });

  it("walks the probes in order and leaves unmatched tokens out", () => {
    const colors = resolveThemeTokens([[rule("storage.type", "#aaaaaa"), rule("support.class", "#bbbbbb")]], undefined, "T");
    expect(colors).toEqual({ keyword: "#aaaaaa", type: "#bbbbbb" });
  });

  it("applies user customizations over the theme, the per-theme block last", () => {
    const theme = [rule("string", "#000001"), rule("comment", "#000002"), rule("entity.name.function", "#000003")];
    const custom = {
      strings: "#200001",
      comments: { foreground: "#200002" },
      textMateRules: [rule("entity.name.function", "#200003")],
      "[My Theme]": { comments: "#300002" },
      "[Other Theme]": { strings: "#400001" },
    };
    const colors = resolveThemeTokens([theme], custom, "My Theme");
    expect(colors.string).toBe("#200001");
    expect(colors.comment).toBe("#300002");
    expect(colors.function).toBe("#200003");
  });

  it("reads rules from tokenColors, a tmTheme-style settings array or a bare array", () => {
    expect(rulesOf({ tokenColors: [rule("a", "#111111")] })).toHaveLength(1);
    expect(rulesOf({ settings: [{ settings: { foreground: "#111111" } }, rule("a", "#222222")] })).toHaveLength(2);
    expect(rulesOf([rule("a", "#111111"), "junk"])).toHaveLength(1);
    expect(rulesOf({ tokenColors: "./other.json" })).toEqual([]);
    expect(rulesOf(undefined)).toEqual([]);
  });
});
