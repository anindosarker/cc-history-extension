import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeProjectDirName } from "../src/extension/projectPath";

/** Encode the way Claude Code does: "/" and "." both become "-". */
const encode = (p: string) => p.replace(/[/. ]/g, "-");

describe("project dir name decoding", () => {
  let root: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-history-"));
    fs.mkdirSync(path.join(root, "Work", "my-app", ".claude", "skills", "v1.2"), { recursive: true });
    fs.mkdirSync(path.join(root, "Work", "my", "app"), { recursive: true });
    fs.mkdirSync(path.join(root, "Work", "Side Project"), { recursive: true });
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("recovers dots and dashes by checking the filesystem", () => {
    const real = path.join(root, "Work", "my-app", ".claude", "skills", "v1.2");
    expect(decodeProjectDirName(encode(real))).toBe(real);
  });

  it("prefers a slash when both a dashed and a nested folder exist", () => {
    const real = path.join(root, "Work", "my", "app");
    expect(decodeProjectDirName(encode(real))).toBe(real);
  });

  it("recovers spaces", () => {
    const real = path.join(root, "Work", "Side Project");
    expect(decodeProjectDirName(encode(real))).toBe(real);
  });

  it("falls back to slashes for paths that no longer exist", () => {
    expect(decodeProjectDirName("-nope-gone-x-y", () => false)).toBe("/nope/gone/x/y");
    expect(decodeProjectDirName("-nope--hidden", () => false)).toBe("/nope/.hidden");
  });

  it("returns non-encoded names unchanged", () => {
    expect(decodeProjectDirName("plain", () => false)).toBe("plain");
  });
});
