import { describe, expect, it } from "vitest";
import { resumeCommand } from "../src/extension/resumeCommand";
import type { SessionMeta } from "../src/shared/types";

const meta: SessionMeta = { sessionId: "abc-123", filePath: "/f", cwd: "/a", projectName: "a", title: "T", titleSource: "ai", messageCount: 1, filesChanged: 0, mtime: 0, size: 0 };

describe("resume command", () => {
  it("resumes plainly by default", () => {
    expect(resumeCommand("claude", meta)).toBe("claude --resume abc-123");
    expect(resumeCommand("claude", meta, false)).toBe("claude --resume abc-123");
  });

  it("adds the bypass permission mode when asked", () => {
    expect(resumeCommand("claude", meta, true)).toBe("claude --resume abc-123 --permission-mode bypassPermissions");
  });

  it("uses the configured command and quotes odd session ids", () => {
    expect(resumeCommand("npx claude", { ...meta, sessionId: "a b'c" }, true)).toBe(
      "npx claude --resume 'a b'\\''c' --permission-mode bypassPermissions",
    );
  });
});
