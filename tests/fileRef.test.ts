import { describe, expect, it } from "vitest";
import { parseFileRef } from "../src/shared/fileRef";
import { resolveFilePath } from "../src/extension/filePaths";

describe("file reference detector", () => {
  it("accepts absolute, home-relative and relative paths with an extension", () => {
    expect(parseFileRef("/Users/me/proj/src/parser.ts")).toEqual({ path: "/Users/me/proj/src/parser.ts" });
    expect(parseFileRef("/usr/bin/env")).toEqual({ path: "/usr/bin/env" });
    expect(parseFileRef("~/.claude/settings.json")).toEqual({ path: "~/.claude/settings.json" });
    expect(parseFileRef("src/parser.ts")).toEqual({ path: "src/parser.ts" });
    expect(parseFileRef("./src/a.test.tsx")).toEqual({ path: "./src/a.test.tsx" });
    expect(parseFileRef("../lib/util.mjs")).toEqual({ path: "../lib/util.mjs" });
    expect(parseFileRef("  src/x.css  ")).toEqual({ path: "src/x.css" });
  });

  it("splits a :LINE or :LINE:COL suffix", () => {
    expect(parseFileRef("src/parser.ts:12")).toEqual({ path: "src/parser.ts", line: 12 });
    expect(parseFileRef("src/parser.ts:12:4")).toEqual({ path: "src/parser.ts", line: 12, column: 4 });
    expect(parseFileRef("/a/b.ts:120:7")).toEqual({ path: "/a/b.ts", line: 120, column: 7 });
    expect(parseFileRef("~/a/b.ts:3")).toEqual({ path: "~/a/b.ts", line: 3 });
    // A zero line is not a location.
    expect(parseFileRef("src/parser.ts:0")).toBeUndefined();
  });

  it("rejects URLs, bare words, slashless tokens, version numbers, commands and globs", () => {
    for (const s of [
      "https://example.com/a.ts",
      "http://x/y.js:1",
      "file:///a/b.ts",
      "www.example.com/a.ts",
      "a/b",
      "npm run x",
      "pnpm test",
      "0.1.0",
      "parser.ts",
      "README",
      "src/**/*.ts",
      "src/{a,b}.ts",
      "src/",
      "/",
      "",
      "   ",
      "a//b.ts",
      "C:\\Users\\me\\a.ts",
      "`src/a.ts`",
      "src/a.ts:",
      "src/a.ts:12:",
      "foo/bar.ts and baz",
    ]) {
      expect(parseFileRef(s), s).toBeUndefined();
    }
  });
});

describe("host path resolution", () => {
  it("resolves relative paths against the session cwd and ~ against home", () => {
    expect(resolveFilePath("/abs/x.ts", "/proj", "/home/me")).toBe("/abs/x.ts");
    expect(resolveFilePath("src/x.ts", "/proj", "/home/me")).toBe("/proj/src/x.ts");
    expect(resolveFilePath("./src/x.ts", "/proj", "/home/me")).toBe("/proj/src/x.ts");
    expect(resolveFilePath("../x.ts", "/proj/sub", "/home/me")).toBe("/proj/x.ts");
    expect(resolveFilePath("~/x.ts", "/proj", "/home/me")).toBe("/home/me/x.ts");
    expect(resolveFilePath("/a/../b.ts", "/proj", "/home/me")).toBe("/b.ts");
  });
});
