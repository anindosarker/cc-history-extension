import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionBuilder } from "../src/extension/parser";
import { TailReader } from "../src/extension/tail";
import { assistantMsg, toolResult, toolUse, userMsg } from "./fixtures";

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-history-tail-"));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function file(name: string, text: string): string {
  const p = path.join(root, name);
  fs.writeFileSync(p, text);
  return p;
}

describe("TailReader", () => {
  it("returns the whole file first, then only the appended lines", async () => {
    const p = file("grow.jsonl", userMsg("one") + "\n" + assistantMsg([{ type: "text", text: "two" }]) + "\n");
    const tail = new TailReader(p);
    const first = await tail.read();
    expect(first?.reset).toBe(true);
    expect(first?.lines).toHaveLength(2);
    expect(await tail.read()).toBeUndefined();
    fs.appendFileSync(p, userMsg("three") + "\n" + assistantMsg([{ type: "text", text: "four" }]) + "\n");
    const second = await tail.read();
    expect(second?.reset).toBe(false);
    expect(second?.lines).toHaveLength(2);
    expect(JSON.parse(second!.lines[0]).message.content).toBe("three");
  });

  it("holds a partial line until its newline arrives and keeps split multi-byte characters intact", async () => {
    const p = file("partial.jsonl", userMsg("a") + "\n");
    const tail = new TailReader(p);
    await tail.read();
    const full = userMsg("héllo wörld");
    const bytes = Buffer.from(full + "\n");
    // Cut inside the two-byte "é".
    const cut = bytes.indexOf(Buffer.from("é")) + 1;
    fs.appendFileSync(p, bytes.subarray(0, cut));
    expect((await tail.read())?.lines).toEqual([]);
    fs.appendFileSync(p, bytes.subarray(cut));
    const r = await tail.read();
    expect(r?.lines).toHaveLength(1);
    expect(JSON.parse(r!.lines[0]).message.content).toBe("héllo wörld");
  });

  it("delivers a final line without a newline once it parses", async () => {
    const p = file("nonl.jsonl", userMsg("a"));
    const tail = new TailReader(p);
    expect((await tail.read())?.lines).toHaveLength(1);
    fs.appendFileSync(p, "\n" + userMsg("b"));
    expect((await tail.read())?.lines).toHaveLength(1);
  });

  it("reports a reset when the file shrinks or its first bytes change", async () => {
    const p = file("rewrite.jsonl", userMsg("first") + "\n" + userMsg("second") + "\n");
    const tail = new TailReader(p);
    await tail.read();
    fs.writeFileSync(p, userMsg("first") + "\n");
    const shrunk = await tail.read();
    expect(shrunk?.reset).toBe(true);
    expect(shrunk?.lines).toHaveLength(1);
    fs.writeFileSync(p, userMsg("other start, same length?") + "\n" + userMsg("x") + "\n" + userMsg("y") + "\n");
    const rewritten = await tail.read();
    expect(rewritten?.reset).toBe(true);
    expect(rewritten?.lines).toHaveLength(3);
  });
});

describe("incremental parse through SessionBuilder", () => {
  it("appends two records as two new turns and keeps the earlier ones", async () => {
    const p = file("inc.jsonl", userMsg("one") + "\n" + assistantMsg([{ type: "text", text: "two" }]) + "\n");
    const tail = new TailReader(p);
    const b = new SessionBuilder();
    for (const l of (await tail.read())!.lines) b.push(l);
    expect(b.takeAppend()).toEqual({ offset: 0, turns: expect.any(Array) });
    expect(b.finish().turns).toHaveLength(2);
    fs.appendFileSync(p, userMsg("three") + "\n" + assistantMsg([{ type: "text", text: "four" }]) + "\n");
    for (const l of (await tail.read())!.lines) b.push(l);
    const append = b.takeAppend();
    expect(append?.offset).toBe(2);
    expect(append?.turns.map((t) => t.blocks[0])).toEqual([
      { type: "text", text: "three" },
      { type: "text", text: "four" },
    ]);
    const all = b.finish().turns;
    expect(all).toHaveLength(4);
    expect(all[0].blocks).toEqual([{ type: "text", text: "one" }]);
    expect(b.takeAppend()).toBeUndefined();
  });

  it("resends from the turn a late tool result or a merged assistant record changed", () => {
    const b = new SessionBuilder();
    b.push(userMsg("go"));
    b.push(assistantMsg([toolUse("t1", "Agent", { prompt: "x" })], {}, "m1"));
    b.push(userMsg("meanwhile"));
    b.takeAppend();
    // The Agent result lands after a later turn exists: everything from the tool_use turn is resent.
    b.push(toolResult("t1", "agent done"));
    const late = b.takeAppend();
    expect(late?.offset).toBe(1);
    expect(late?.turns).toHaveLength(2);
    const tool = late!.turns[0].blocks[0];
    expect(tool.type === "tool_use" && tool.result?.text).toBe("agent done");
    // A streamed continuation of the last assistant message replaces that one turn.
    b.push(assistantMsg([{ type: "text", text: "part one" }], {}, "m2"));
    b.takeAppend();
    b.push(assistantMsg([{ type: "text", text: "part two" }], {}, "m2"));
    const merged = b.takeAppend();
    expect(merged?.offset).toBe(3);
    expect(merged?.turns).toHaveLength(1);
    expect(merged?.turns[0].blocks).toHaveLength(2);
    expect(b.finish().turns).toHaveLength(4);
  });

  it("starts over after a truncated file: a fresh builder sees only what the file holds now", async () => {
    const p = file("trunc.jsonl", userMsg("one") + "\n" + userMsg("two") + "\n" + userMsg("three") + "\n");
    const tail = new TailReader(p);
    let b = new SessionBuilder();
    for (const l of (await tail.read())!.lines) b.push(l);
    expect(b.finish().turns).toHaveLength(3);
    fs.writeFileSync(p, userMsg("one") + "\n");
    const r = await tail.read();
    expect(r?.reset).toBe(true);
    b = new SessionBuilder();
    for (const l of r!.lines) b.push(l);
    expect(b.finish().turns).toHaveLength(1);
  });
});
