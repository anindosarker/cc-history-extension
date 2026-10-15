#!/usr/bin/env node
// Builds a synthetic Claude Code data directory for screenshots and the intro video.
// Everything here is invented: three fictional projects, a fictional engineer and
// fictional code. Nothing is read from the real ~/.claude.
//
//   node scripts/make-demo-data.mjs [outDir]      (default /tmp/cch-demo)
//
// Writes <outDir>/projects/<encoded cwd>/<sessionId>.jsonl, subagent transcripts under
// <sessionId>/subagents/, and an empty <outDir>/sessions folder for the live-status lookup.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const OUT = path.resolve(process.argv[2] ?? "/tmp/cch-demo");
const PROJECTS = path.join(OUT, "projects");
const SESSIONS = path.join(OUT, "sessions");
const VERSION = "2.0.31";
const MODEL = "claude-opus-5-5";
const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Deterministic ids so reruns produce the same files.
let seed = 0x5eed1234;
function rand() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 0xffffffff;
}
const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rand() * 16)]).join("");
const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
const msgId = () => `msg_01${hex(22).toUpperCase()}`;
const toolId = () => `toolu_01${hex(22).toUpperCase()}`;
const encodeCwd = (cwd) => cwd.replace(/[/. ]/g, "-");

/** A small PNG drawn in memory, used as the pasted screenshot in the rich session. */
function makePng(width, height, paint) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = y * stride + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A fake "webhook deliveries" bar chart: seven days, the last two mostly failed. */
function dashboardPng() {
  const W = 480;
  const H = 200;
  const bars = [
    [52, 2],
    [61, 1],
    [48, 0],
    [57, 3],
    [66, 2],
    [59, 31],
    [63, 44],
  ];
  return makePng(W, H, (x, y) => {
    if (y < 28) return x < 160 && y > 8 && y < 20 && x > 16 ? [230, 230, 230] : [38, 38, 42];
    if (y === 28) return [60, 60, 66];
    const slot = Math.floor((x - 24) / 64);
    const inSlot = (x - 24) % 64;
    if (x >= 24 && slot >= 0 && slot < 7 && inSlot >= 10 && inSlot < 50) {
      const [ok, failed] = bars[slot];
      const total = ok + failed;
      const top = H - 20 - total * 2;
      const splitY = H - 20 - failed * 2;
      if (y >= top && y < H - 20) return y >= splitY ? [214, 69, 69] : [78, 154, 110];
    }
    if (y === H - 20) return [60, 60, 66];
    return [24, 24, 27];
  });
}

/** Everything a Claude Code jsonl record carries besides the message itself. */
class Session {
  constructor({ cwd, branch, startAt, title }) {
    this.cwd = cwd;
    this.branch = branch;
    this.id = uuid();
    this.t = startAt;
    this.lines = [];
    this.parent = null;
    this.agents = [];
    this.turns = 0;
    this.title = title;
    this.lines.push({ type: "ai-title", aiTitle: title, sessionId: this.id, timestamp: this.iso() });
  }
  iso() {
    return new Date(this.t).toISOString();
  }
  tick(seconds) {
    this.t += Math.round(seconds * 1000 * (0.85 + rand() * 0.3));
  }
  base(extra = {}) {
    const id = uuid();
    const rec = {
      parentUuid: this.parent,
      isSidechain: false,
      userType: "external",
      cwd: this.cwd,
      sessionId: this.id,
      version: VERSION,
      gitBranch: this.branch,
      uuid: id,
      timestamp: this.iso(),
      ...extra,
    };
    this.parent = id;
    return rec;
  }
  push(rec) {
    this.lines.push(rec);
  }
  user(content, seconds = 40) {
    this.tick(seconds);
    this.push({ ...this.base(), type: "user", message: { role: "user", content } });
    this.turns++;
  }
  /** One assistant API turn: text, thinking and tool_use blocks sharing one message id. */
  assistant(blocks, seconds = 6) {
    this.tick(seconds);
    const id = msgId();
    const out = Math.max(20, Math.round(JSON.stringify(blocks).length / 4));
    const usage = {
      input_tokens: 3 + Math.floor(rand() * 20),
      cache_creation_input_tokens: Math.floor(rand() * 2000),
      cache_read_input_tokens: 18000 + Math.floor(rand() * 30000),
      output_tokens: out,
    };
    for (const b of blocks) {
      this.push({
        ...this.base({ requestId: `req_01${hex(22).toUpperCase()}` }),
        type: "assistant",
        message: { id, type: "message", role: "assistant", model: MODEL, content: [b], stop_reason: null, usage },
      });
    }
    this.turns++;
  }
  say(text, seconds) {
    this.assistant([{ type: "text", text }], seconds);
  }
  think(thinking, text, seconds) {
    const blocks = [{ type: "thinking", thinking, signature: hex(32) }];
    if (text) blocks.push({ type: "text", text });
    this.assistant(blocks, seconds);
  }
  /** An assistant tool call, then the tool result as a user record. Returns the tool_use id. */
  tool(name, input, result, { text, isError = false, seconds = 4, resultSeconds = 2 } = {}) {
    const id = toolId();
    const blocks = [];
    if (text) blocks.push({ type: "text", text });
    blocks.push({ type: "tool_use", id, name, input });
    this.assistant(blocks, seconds);
    this.tick(resultSeconds);
    this.push({
      ...this.base(),
      type: "user",
      message: { role: "user", content: [{ tool_use_id: id, type: "tool_result", content: result, is_error: isError }] },
      toolUseResult: isError ? { error: result } : { stdout: typeof result === "string" ? result : "", stderr: "" },
    });
    return id;
  }
  read(file, content, opts) {
    const numbered = content
      .split("\n")
      .map((l, i) => `${String(i + 1).padStart(6, " ")}\t${l}`)
      .join("\n");
    return this.tool("Read", { file_path: file }, numbered, opts);
  }
  edit(file, oldString, newString, opts) {
    return this.tool("Edit", { file_path: file, old_string: oldString, new_string: newString }, `The file ${file} has been updated successfully.`, opts);
  }
  write(file, content, opts) {
    return this.tool("Write", { file_path: file, content }, `File created successfully at: ${file}`, opts);
  }
  bash(command, description, output, opts) {
    return this.tool("Bash", { command, description }, output, opts);
  }
  recap(text, awayMinutes = 25) {
    this.tick(awayMinutes * 60);
    this.push({
      type: "system",
      subtype: "away_summary",
      content: `${text} (disable recaps in /config)`,
      uuid: uuid(),
      timestamp: this.iso(),
      isSidechain: false,
      isMeta: false,
      cwd: this.cwd,
      sessionId: this.id,
    });
    this.turns++;
  }
  /** Spawns a subagent: an Agent tool call in this transcript plus its own sidechain transcript. */
  agent({ name, description, prompt, model = "claude-sonnet-5-5", color, run, result }, opts = {}) {
    this.tick(opts.seconds ?? 5);
    opts = { ...opts, seconds: 0 };
    const sub = new Subagent(this, name);
    sub.user(prompt);
    run(sub);
    sub.say(result, 8);
    const agentId = `a${name}-${hex(16)}`;
    const id = this.tool(
      "Agent",
      { description, prompt, subagent_type: "general-purpose", name },
      `agent_id: ${name}@${agentId}\n\n${result}`,
      { ...opts, resultSeconds: Math.max(2, (sub.t - this.t) / 1000) },
    );
    this.agents.push({ agentId, sub, meta: { name, agentType: "general-purpose", description, model, color, toolUseId: id } });
    return id;
  }
  writeTo(projectsDir) {
    const dir = path.join(projectsDir, encodeCwd(this.cwd));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${this.id}.jsonl`);
    fs.writeFileSync(file, this.lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    for (const a of this.agents) {
      const subDir = path.join(dir, this.id, "subagents");
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, `agent-${a.agentId}.jsonl`), a.sub.lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      fs.writeFileSync(path.join(subDir, `agent-${a.agentId}.meta.json`), JSON.stringify(a.meta, null, 2) + "\n");
      fs.utimesSync(path.join(subDir, `agent-${a.agentId}.jsonl`), a.sub.t / 1000, a.sub.t / 1000);
    }
    fs.utimesSync(file, this.t / 1000, this.t / 1000);
    return file;
  }
}

/** A subagent transcript: the same records, all sidechain, sharing the parent's session id. */
class Subagent extends Session {
  constructor(parentSession, name) {
    super({ cwd: parentSession.cwd, branch: parentSession.branch, startAt: parentSession.t, title: "" });
    this.lines = [];
    this.id = parentSession.id;
    this.agentName = name;
  }
  base(extra = {}) {
    return { ...super.base(extra), isSidechain: true, agentId: this.agentName };
  }
}

/* --------------------------------------------------------------------------------------- */
/* acme-storefront                                                                          */
/* --------------------------------------------------------------------------------------- */

const ACME = "/Users/demo/code/acme-storefront";

const STRIPE_HANDLER = `import type { Request, Response } from "express";
import Stripe from "stripe";
import { stripe } from "../lib/stripe";
import { fulfillOrder } from "../orders/fulfill";
import { recordEvent } from "../db/webhookEvents";

const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

export async function stripeWebhook(req: Request, res: Response): Promise<void> {
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"] ?? "", secret);
  } catch (err) {
    res.status(400).send(\`Webhook signature failed: \${(err as Error).message}\`);
    return;
  }

  await recordEvent(event.id, event.type);
  try {
    await handle(event);
  } catch (err) {
    console.error("webhook handler failed", event.id, err);
  }
  res.status(200).json({ received: true });
}

async function handle(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await fulfillOrder(event.data.object as Stripe.Checkout.Session);
      break;
    case "payment_intent.payment_failed":
      // Nothing to do yet; the order stays pending.
      break;
    default:
      break;
  }
}
`;

const WEBHOOK_EVENTS = `import { db } from "./client";

export async function recordEvent(id: string, type: string): Promise<void> {
  await db
    .insertInto("webhook_events")
    .values({ id, type, received_at: new Date() })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
}

export async function hasSeen(id: string): Promise<boolean> {
  const row = await db.selectFrom("webhook_events").select("id").where("id", "=", id).executeTakeFirst();
  return row !== undefined;
}
`;

const RETRY_TS = `export interface RetryOptions {
  /** Attempts before the job is parked, including the first one. */
  maxAttempts: number;
  /** Delay before the second attempt, doubled for every attempt after it. */
  baseDelayMs: number;
  /** Upper bound on the delay, so attempt five does not wait an hour. */
  maxDelayMs: number;
  onAttempt?: (attempt: number, err: unknown) => void;
}

export const WEBHOOK_RETRY: RetryOptions = {
  maxAttempts: 5,
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
};

export function delayFor(attempt: number, opts: RetryOptions): number {
  const raw = opts.baseDelayMs * 2 ** (attempt - 1);
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.min(opts.maxDelayMs, Math.round(raw * jitter));
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      opts.onAttempt?.(attempt, err);
      if (attempt >= opts.maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, delayFor(attempt, opts)));
    }
  }
}
`;

const MIGRATION_SQL = `-- Track delivery attempts so failed Stripe events can be retried and inspected.
alter table webhook_events
  add column attempts integer not null default 0,
  add column last_error text,
  add column status text not null default 'pending'
    check (status in ('pending', 'done', 'failed', 'parked'));

create index webhook_events_status_idx on webhook_events (status, received_at);
`;

const STRIPE_TEST = `import { describe, expect, it, vi } from "vitest";
import { stripeWebhook } from "../../src/webhooks/stripe";
import { makeEvent, makeReq, makeRes } from "../helpers/stripeEvent";

vi.mock("../../src/orders/fulfill", () => ({ fulfillOrder: vi.fn() }));

describe("stripeWebhook", () => {
  it("rejects a bad signature", async () => {
    const res = makeRes();
    await stripeWebhook(makeReq("not-signed"), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("acknowledges a completed checkout", async () => {
    const res = makeRes();
    await stripeWebhook(makeReq(makeEvent("checkout.session.completed")), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
`;

const RUNBOOK = `# Webhooks

## Stripe

Endpoint: \`POST /webhooks/stripe\`. Signatures are checked with \`STRIPE_WEBHOOK_SECRET\`.

Every event is written to \`webhook_events\` before it is handled, so a duplicate delivery
is ignored.

## When fulfilment fails

Check the app logs for \`webhook handler failed\` and re-send the event from the Stripe
dashboard once the cause is fixed.
`;

function richStripeSession() {
  const s = new Session({
    cwd: ACME,
    branch: "feat/webhook-retries",
    startAt: NOW - 2 * HOUR - 52 * 60_000,
    title: "Add Stripe webhook retries",
  });
  const png = dashboardPng().toString("base64");
  /** The handler as it stands after each edit, so later reads show the real content. */
  let handler = STRIPE_HANDLER;
  const editHandler = (oldString, newString, opts) => {
    if (!handler.includes(oldString)) throw new Error("handler edit does not match");
    handler = handler.replace(oldString, () => newString);
    return s.edit(`${ACME}/src/webhooks/stripe.ts`, oldString, newString, opts);
  };

  s.user(
    [
      {
        type: "text",
        text: "Stripe webhooks that fail on our side are silently dropped. We return 200 even when the handler throws, so Stripe never retries and the order stays pending forever. Last night 44 of 107 deliveries failed because the fulfilment service was restarting. Can you add retries with backoff on our side? Dashboard from this morning:",
      },
      { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
    ],
    0,
  );

  s.think(
    "The handler swallows errors and always answers 200, so the problem is really two things: the response code and the lack of any retry state. I should read the handler and the events table before proposing anything, and check what the test suite covers today.",
    "I'll look at the current handler and the events table before changing anything.",
  );
  s.read(`${ACME}/src/webhooks/stripe.ts`, STRIPE_HANDLER);
  s.tool("Grep", { pattern: "webhook_events", path: ACME, output_mode: "files_with_matches" }, `${ACME}/src/db/webhookEvents.ts\n${ACME}/src/db/schema.ts\n${ACME}/db/migrations/0031_webhook_events.sql`);
  s.read(`${ACME}/src/db/webhookEvents.ts`, WEBHOOK_EVENTS);
  s.tool(
    "Read",
    { file_path: `${ACME}/src/db/schema.ts`, offset: 120, limit: 14 },
    `   120\texport interface WebhookEventsTable {\n   121\t  id: string;\n   122\t  type: string;\n   123\t  received_at: Date;\n   124\t}\n   125\t\n   126\texport interface Database {\n   127\t  orders: OrdersTable;\n   128\t  order_items: OrderItemsTable;\n   129\t  products: ProductsTable;\n   130\t  carts: CartsTable;\n   131\t  webhook_events: WebhookEventsTable;\n   132\t  users: UsersTable;\n   133\t}`,
  );
  s.bash(
    "pnpm vitest run tests/webhooks",
    "Run the webhook tests",
    " ✓ tests/webhooks/stripe.test.ts (2 tests) 41ms\n\n Test Files  1 passed (1)\n      Tests  2 passed (2)\n   Start at  09:14:07\n   Duration  1.12s",
  );
  s.say(
    `The handler does two things that lose events: it catches every error from \`handle\` and still answers 200, and \`webhook_events\` only records that an event arrived, not whether it was processed.

Here is what I propose:

| Piece | Change |
| --- | --- |
| \`webhook_events\` | Add \`attempts\`, \`status\` and \`last_error\` columns |
| \`src/lib/retry.ts\` | New \`withRetry\` helper, exponential backoff with jitter, capped |
| \`stripeWebhook\` | Run the handler through \`withRetry\`, answer 500 only after the last attempt |
| Runbook | Document how to find parked events |

Stripe keeps retrying for three days when we answer with a 5xx, so answering 500 after our own attempts are exhausted gives us a second safety net without double-processing, because \`hasSeen\` already dedupes.

Two questions before I start. How many local attempts do you want, and should every attempt be logged or only the final failure?`,
  );

  s.user("Go ahead. Cap it at 5 attempts and log every attempt, we want them in Datadog. Base delay 2s is fine.", 95);

  s.write(`${ACME}/db/migrations/0042_webhook_events.sql`, MIGRATION_SQL, { text: "Starting with the migration." });
  s.write(`${ACME}/src/lib/retry.ts`, RETRY_TS);
  s.edit(
    `${ACME}/src/db/webhookEvents.ts`,
    `export async function hasSeen(id: string): Promise<boolean> {`,
    `export async function markAttempt(id: string, attempt: number, err: unknown): Promise<void> {
  await db
    .updateTable("webhook_events")
    .set({ attempts: attempt, last_error: err instanceof Error ? err.message : String(err) })
    .where("id", "=", id)
    .execute();
}

export async function markStatus(id: string, status: "done" | "failed" | "parked"): Promise<void> {
  await db.updateTable("webhook_events").set({ status }).where("id", "=", id).execute();
}

export async function hasSeen(id: string): Promise<boolean> {`,
  );
  editHandler(
    `import { recordEvent } from "../db/webhookEvents";`,
    `import { hasSeen, markAttempt, markStatus, recordEvent } from "../db/webhookEvents";
import { WEBHOOK_RETRY, withRetry } from "../lib/retry";`,
  );
  editHandler(
    `  await recordEvent(event.id, event.type);
  try {
    await handle(event);
  } catch (err) {
    console.error("webhook handler failed", event.id, err);
  }
  res.status(200).json({ received: true });`,
    `  if (await hasSeen(event.id)) {
    res.status(200).json({ received: true, duplicate: true });
    return;
  }
  await recordEvent(event.id, event.type);
  try {
    await withRetry(() => handle(event), {
      ...WEBHOOK_RETRY,
      onAttempt: (attempt, err) => {
        console.warn("webhook attempt failed", { eventId: event.id, type: event.type, attempt, err });
        void markAttempt(event.id, attempt, err);
      },
    });
    await markStatus(event.id, "done");
    res.status(200).json({ received: true });
  } catch (err) {
    await markStatus(event.id, "failed");
    res.status(500).json({ received: false, error: (err as Error).message });
  }`,
  );
  s.bash(
    "pnpm typecheck",
    "Type-check the project",
    `src/db/webhookEvents.ts:18:11 - error TS2353: Object literal may only specify known properties, and 'attempts' does not exist in type 'UpdateObject<Database, "webhook_events">'.

18     .set({ attempts: attempt, last_error: err instanceof Error ? err.message : String(err) })
             ~~~~~~~~

Found 1 error in src/db/webhookEvents.ts:18`,
    { isError: true },
  );
  s.edit(
    `${ACME}/src/db/schema.ts`,
    `export interface WebhookEventsTable {
  id: string;
  type: string;
  received_at: Date;
}`,
    `export interface WebhookEventsTable {
  id: string;
  type: string;
  received_at: Date;
  attempts: number;
  last_error: string | null;
  status: "pending" | "done" | "failed" | "parked";
}`,
    { text: "The schema type needs the new columns." },
  );
  s.bash("pnpm typecheck", "Type-check the project", "", { seconds: 3 });

  s.agent({
    name: "test-runner",
    description: "Run and repair the webhook tests",
    color: "blue",
    prompt:
      "Run `pnpm vitest run tests/webhooks` in /Users/demo/code/acme-storefront. The Stripe handler now retries through src/lib/retry.ts and answers 500 once five attempts fail. Fix tests that assumed the old behaviour and add one that proves a handler failure is retried and then parked. Do not change src/.",
    run: (a) => {
      a.bash(
        "pnpm vitest run tests/webhooks",
        "Run the webhook tests",
        ` ✓ tests/webhooks/stripe.test.ts > rejects a bad signature 12ms\n ✗ tests/webhooks/stripe.test.ts > acknowledges a completed checkout 2004ms\n   TypeError: Cannot read properties of undefined (reading 'json')\n\n Test Files  1 failed (1)\n      Tests  1 failed | 1 passed (2)`,
        { isError: true },
      );
      a.read(`${ACME}/tests/webhooks/stripe.test.ts`, STRIPE_TEST);
      a.tool(
        "Read",
        { file_path: `${ACME}/tests/helpers/stripeEvent.ts` },
        `     1\timport { vi } from "vitest";\n     2\t\n     3\texport function makeRes() {\n     4\t  const res: Record<string, unknown> = {};\n     5\t  res.status = vi.fn(() => res);\n     6\t  res.send = vi.fn(() => res);\n     7\t  return res as never;\n     8\t}`,
      );
      a.say("The fake response has no `json` method, so the success path throws inside the handler and gets retried for two seconds. I'll add `json` and a fake-timer helper for the backoff.");
      a.write(
        `${ACME}/tests/helpers/stripeEvent.ts`,
        `import { vi } from "vitest";
import type Stripe from "stripe";

export function makeRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn(() => res);
  res.send = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res as never;
}

export function makeReq(body: unknown) {
  return { body, headers: { "stripe-signature": "t=1,v1=test" } } as never;
}

export function makeEvent(type: Stripe.Event.Type, id = "evt_test_1"): Stripe.Event {
  return { id, type, data: { object: { id: "cs_test_1" } } } as unknown as Stripe.Event;
}

/** Runs fn with fake timers and drains every pending backoff delay. */
export async function withDrainedTimers<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const p = fn();
    await vi.runAllTimersAsync();
    return await p;
  } finally {
    vi.useRealTimers();
  }
}
`,
      );
      a.edit(
        `${ACME}/tests/webhooks/stripe.test.ts`,
        `import { makeEvent, makeReq, makeRes } from "../helpers/stripeEvent";

vi.mock("../../src/orders/fulfill", () => ({ fulfillOrder: vi.fn() }));`,
        `import { makeEvent, makeReq, makeRes, withDrainedTimers } from "../helpers/stripeEvent";
import { fulfillOrder } from "../../src/orders/fulfill";

vi.mock("../../src/orders/fulfill", () => ({ fulfillOrder: vi.fn() }));
vi.mock("../../src/db/webhookEvents", () => ({
  recordEvent: vi.fn(),
  hasSeen: vi.fn(async () => false),
  markAttempt: vi.fn(),
  markStatus: vi.fn(),
}));`,
      );
      a.edit(
        `${ACME}/tests/webhooks/stripe.test.ts`,
        `    expect(res.status).toHaveBeenCalledWith(200);
  });
});`,
        `    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("retries a failing handler five times, then answers 500", async () => {
    vi.mocked(fulfillOrder).mockRejectedValue(new Error("fulfilment down"));
    const res = makeRes();
    await withDrainedTimers(() => stripeWebhook(makeReq(makeEvent("checkout.session.completed")), res));
    expect(fulfillOrder).toHaveBeenCalledTimes(5);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});`,
      );
      a.bash(
        "pnpm vitest run tests/webhooks",
        "Run the webhook tests",
        ` ✓ tests/webhooks/stripe.test.ts (3 tests) 58ms\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)\n   Start at  09:31:40\n   Duration  1.08s`,
      );
    },
    result:
      "All three webhook tests pass. The old failure was the fake response lacking `json`, which made the success path throw and retry. I added `json` to `makeRes`, a `withDrainedTimers` helper so the backoff does not slow the suite, mocked the events table, and added a test proving five attempts then a 500. Files: tests/helpers/stripeEvent.ts (rewritten), tests/webhooks/stripe.test.ts (two edits). src/ untouched.",
  });

  s.agent({
    name: "api-reviewer",
    description: "Review the retry change for API and operational gaps",
    color: "green",
    prompt:
      "Review the uncommitted changes in /Users/demo/code/acme-storefront (git diff). Focus on: duplicate processing, what Stripe sees on each response code, and whether operators can find stuck events. Fix small gaps in types or docs directly; report anything larger instead of changing it.",
    run: (a) => {
      a.bash("git diff --stat", "Show changed files", " db/migrations/0042_webhook_events.sql | 8 +\n src/db/schema.ts                        | 3 +\n src/db/webhookEvents.ts                 | 14 +\n src/lib/retry.ts                        | 41 +\n src/webhooks/stripe.ts                  | 26 +-\n 5 files changed, 88 insertions(+), 4 deletions(-)");
      a.read(`${ACME}/src/webhooks/stripe.ts`, handler);
      a.read(`${ACME}/src/lib/retry.ts`, RETRY_TS);
      a.tool("Grep", { pattern: "parked", path: ACME, output_mode: "content" }, `${ACME}/db/migrations/0042_webhook_events.sql:5:    check (status in ('pending', 'done', 'failed', 'parked'));\n${ACME}/src/db/webhookEvents.ts:25:export async function markStatus(id: string, status: "done" | "failed" | "parked"): Promise<void> {`);
      a.say("The status column allows `parked` but nothing ever sets it, and the public event type has no field for attempts. I'll add the field and a short API note, and raise the parked question in the report.");
      a.tool(
        "Read",
        { file_path: `${ACME}/src/webhooks/types.ts` },
        `     1\texport interface WebhookAck {\n     2\t  received: boolean;\n     3\t  duplicate?: boolean;\n     4\t}`,
      );
      a.edit(
        `${ACME}/src/webhooks/types.ts`,
        `export interface WebhookAck {
  received: boolean;
  duplicate?: boolean;
}`,
        `export interface WebhookAck {
  received: boolean;
  duplicate?: boolean;
  /** Present on a 500: how many local attempts were made before giving up. */
  attempts?: number;
  error?: string;
}`,
      );
      a.write(
        `${ACME}/docs/api/webhooks.md`,
        `# Webhook responses

| Status | Meaning | What Stripe does |
| --- | --- | --- |
| 200 | Handled, or a duplicate of a handled event | Nothing |
| 400 | Signature check failed | Marks the delivery failed, no retry |
| 500 | Five local attempts failed | Retries with its own backoff for up to three days |

Every attempt is logged as \`webhook attempt failed\` with the event id and attempt number.
`,
      );
    },
    result:
      "Two small fixes applied: `WebhookAck` gained `attempts` and `error` (src/webhooks/types.ts), and docs/api/webhooks.md now documents what each status code means to Stripe. One gap to decide on: the migration allows a `parked` status but nothing sets it, so an event that fails five times here and three days at Stripe is only distinguishable from a transient failure by its `attempts` count. Suggest marking `parked` when Stripe's final retry fails, or dropping the value. Dedupe looks right: `hasSeen` runs before `recordEvent`, so a Stripe retry of an event we already finished is a no-op.",
  });

  editHandler(
    `    res.status(500).json({ received: false, error: (err as Error).message });`,
    `    res.status(500).json({ received: false, attempts: WEBHOOK_RETRY.maxAttempts, error: (err as Error).message });`,
    { text: "Both agents are done. Taking the reviewer's point about the response body." },
  );
  s.bash("pnpm lint", "Lint the changed files", "");
  s.say(
    `Done so far:

- Migration \`0042\` adds \`attempts\`, \`last_error\` and \`status\` to \`webhook_events\`.
- \`withRetry\` in \`src/lib/retry.ts\`: 5 attempts, 2s base, doubling, capped at 60s, with jitter.
- The handler dedupes on \`hasSeen\`, logs every attempt with the event id, marks \`done\` or \`failed\`, and answers 500 only after the fifth failure so Stripe takes over.
- Tests pass (3), typecheck is clean.

The reviewer raised one open point: the \`parked\` status is defined but never set. Do you want a parked state for events that also exhaust Stripe's three days, or should I drop it?`,
  );

  s.user("What happens to events that fail all five times here and then Stripe gives up too? I'd rather not lose them.", 120);
  s.think(
    "Stripe sends a final failed delivery; after that the event is only in our table with status failed. A nightly job that parks anything failed and older than three days gives operators one query. Keep it small: a query function plus a scheduled call.",
  );
  s.say(
    `They stay in \`webhook_events\` with \`status = 'failed'\` and the last error, so nothing is lost, but nobody would notice them. Two additions make them visible:

\`\`\`ts
// src/db/webhookEvents.ts
export async function parkStale(olderThan: Date): Promise<number> {
  const result = await db
    .updateTable("webhook_events")
    .set({ status: "parked" })
    .where("status", "=", "failed")
    .where("received_at", "<", olderThan)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}
\`\`\`

The nightly job calls \`parkStale(threeDaysAgo)\` and emits a \`webhooks.parked\` count to Datadog, so an alert fires when it is above zero. Parked events can be re-sent from the Stripe dashboard once the cause is fixed. I'll add the query and the runbook entry.`,
  );
  s.edit(
    `${ACME}/src/db/webhookEvents.ts`,
    `export async function hasSeen(id: string): Promise<boolean> {`,
    `/** Events that failed here and are old enough that Stripe has stopped retrying too. */
export async function parkStale(olderThan: Date): Promise<number> {
  const result = await db
    .updateTable("webhook_events")
    .set({ status: "parked" })
    .where("status", "=", "failed")
    .where("received_at", "<", olderThan)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

export async function hasSeen(id: string): Promise<boolean> {`,
  );
  s.tool("Glob", { pattern: "src/jobs/*.ts", path: ACME }, `${ACME}/src/jobs/index.ts\n${ACME}/src/jobs/cleanupCarts.ts\n${ACME}/src/jobs/syncInventory.ts`);
  s.tool(
    "Read",
    { file_path: `${ACME}/src/jobs/cleanupCarts.ts` },
    `     1\timport { db } from "../db/client";\n     2\timport { metrics } from "../lib/metrics";\n     3\t\n     4\texport async function cleanupCarts(): Promise<void> {\n     5\t  const cutoff = new Date(Date.now() - 30 * 86_400_000);\n     6\t  const r = await db.deleteFrom("carts").where("updated_at", "<", cutoff).executeTakeFirst();\n     7\t  metrics.gauge("carts.cleaned", Number(r.numDeletedRows));\n     8\t}`,
  );
  s.write(
    `${ACME}/src/jobs/parkWebhookEvents.ts`,
    `import { parkStale } from "../db/webhookEvents";
import { metrics } from "../lib/metrics";

const STRIPE_RETRY_WINDOW_MS = 3 * 86_400_000;

export async function parkWebhookEvents(): Promise<void> {
  const parked = await parkStale(new Date(Date.now() - STRIPE_RETRY_WINDOW_MS));
  metrics.gauge("webhooks.parked", parked);
}
`,
  );
  s.bash("pnpm vitest run tests/webhooks && pnpm typecheck", "Run webhook tests and typecheck", " ✓ tests/webhooks/stripe.test.ts (3 tests) 61ms\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)");

  s.user("Does hasSeen race if Stripe delivers the same event twice within a few ms?", 80);
  s.say(
    `Yes, two concurrent deliveries can both pass \`hasSeen\` before either inserts. The insert itself is safe because \`recordEvent\` uses \`on conflict do nothing\`, so the fix is to make the insert the gate:

\`\`\`ts
const inserted = await recordEvent(event.id, event.type); // returns false on conflict
if (!inserted) {
  res.status(200).json({ received: true, duplicate: true });
  return;
}
\`\`\`

That turns the check into one atomic statement. I'll make \`recordEvent\` return whether a row was inserted and drop the separate \`hasSeen\` call.`,
  );
  s.edit(
    `${ACME}/src/db/webhookEvents.ts`,
    `export async function recordEvent(id: string, type: string): Promise<void> {
  await db
    .insertInto("webhook_events")
    .values({ id, type, received_at: new Date() })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
}`,
    `/** True when the event is new; false when a row with this id already exists. */
export async function recordEvent(id: string, type: string): Promise<boolean> {
  const r = await db
    .insertInto("webhook_events")
    .values({ id, type, received_at: new Date() })
    .onConflict((oc) => oc.column("id").doNothing())
    .executeTakeFirst();
  return Number(r.numInsertedOrUpdatedRows ?? 0) > 0;
}`,
  );
  editHandler(
    `  if (await hasSeen(event.id)) {
    res.status(200).json({ received: true, duplicate: true });
    return;
  }
  await recordEvent(event.id, event.type);`,
    `  if (!(await recordEvent(event.id, event.type))) {
    res.status(200).json({ received: true, duplicate: true });
    return;
  }`,
  );
  s.bash("pnpm vitest run tests/webhooks && pnpm typecheck", "Run webhook tests and typecheck", " ✓ tests/webhooks/stripe.test.ts (3 tests) 57ms\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)");

  s.recap(
    "Goal: retry failed Stripe webhooks locally and keep the ones that still fail. Done: migration 0042, withRetry helper, handler dedupe and 500 after five attempts, parkStale query and nightly job, tests and types fixed by the test-runner and api-reviewer agents. Next: register parkWebhookEvents in src/jobs/index.ts and update the runbook.",
    35,
  );

  s.user("Back. Register the job and update the runbook, then show me the final diff stat.", 10);
  s.tool(
    "Read",
    { file_path: `${ACME}/src/jobs/index.ts` },
    `     1\timport { schedule } from "../lib/scheduler";\n     2\timport { cleanupCarts } from "./cleanupCarts";\n     3\timport { syncInventory } from "./syncInventory";\n     4\t\n     5\tschedule("0 3 * * *", cleanupCarts);\n     6\tschedule("*/15 * * * *", syncInventory);`,
  );
  s.edit(
    `${ACME}/src/jobs/index.ts`,
    `import { syncInventory } from "./syncInventory";

schedule("0 3 * * *", cleanupCarts);`,
    `import { syncInventory } from "./syncInventory";
import { parkWebhookEvents } from "./parkWebhookEvents";

schedule("0 3 * * *", cleanupCarts);
schedule("30 3 * * *", parkWebhookEvents);`,
  );
  s.read(`${ACME}/docs/runbooks/webhooks.md`, RUNBOOK);
  s.edit(
    `${ACME}/docs/runbooks/webhooks.md`,
    `## When fulfilment fails

Check the app logs for \`webhook handler failed\` and re-send the event from the Stripe
dashboard once the cause is fixed.`,
    `## When fulfilment fails

The handler retries five times with backoff (2s, 4s, 8s, 16s, 32s) and logs every attempt
as \`webhook attempt failed\`. After the fifth failure it answers 500 and Stripe retries on
its own schedule for three days.

## Parked events

Events still failed after three days are marked \`parked\` by the nightly
\`parkWebhookEvents\` job, which emits \`webhooks.parked\` to Datadog. To inspect them:

\`\`\`sql
select id, type, attempts, last_error, received_at
from webhook_events
where status = 'parked'
order by received_at;
\`\`\`

Fix the cause, then re-send each event from the Stripe dashboard. The handler dedupes on
the event id, so re-sending an event that already succeeded is harmless.`,
  );
  s.bash(
    "git diff --stat",
    "Show the final change summary",
    ` db/migrations/0042_webhook_events.sql |  8 ++++
 docs/api/webhooks.md                  | 10 +++++
 docs/runbooks/webhooks.md             | 24 +++++++++--
 src/db/schema.ts                      |  3 ++
 src/db/webhookEvents.ts               | 26 ++++++++++++
 src/jobs/index.ts                     |  2 +
 src/jobs/parkWebhookEvents.ts         | 10 +++++
 src/lib/retry.ts                      | 41 +++++++++++++++++++
 src/webhooks/stripe.ts                | 27 ++++++++++---
 src/webhooks/types.ts                 |  3 ++
 tests/helpers/stripeEvent.ts          | 31 +++++++++++---
 tests/webhooks/stripe.test.ts         | 18 ++++++++-
 12 files changed, 191 insertions(+), 12 deletions(-)`,
  );
  s.say(
    `Everything is in place and nothing is committed yet.

| Area | Files |
| --- | --- |
| Retry and dedupe | \`src/webhooks/stripe.ts\`, \`src/lib/retry.ts\` |
| Persistence | \`db/migrations/0042_webhook_events.sql\`, \`src/db/schema.ts\`, \`src/db/webhookEvents.ts\` |
| Parked events | \`src/jobs/parkWebhookEvents.ts\`, \`src/jobs/index.ts\` |
| Tests | \`tests/webhooks/stripe.test.ts\`, \`tests/helpers/stripeEvent.ts\` |
| Docs | \`docs/runbooks/webhooks.md\`, \`docs/api/webhooks.md\` |

One thing to do before deploying: run migration 0042 first, since the handler writes the new columns on the first failed attempt.`,
  );
  return s;
}

function checkoutValidationSession() {
  const s = new Session({ cwd: ACME, branch: "main", startAt: NOW - 1 * DAY - 3 * HOUR, title: "Checkout form validation" });
  s.user("The checkout form lets people submit an empty postcode and a 15-digit card number. Add client-side validation with zod and show errors under each field. The form is in src/checkout/CheckoutForm.tsx.", 0);
  s.say("I'll read the form and the existing schemas first.");
  s.tool("Glob", { pattern: "src/checkout/**/*.ts*", path: ACME }, `${ACME}/src/checkout/CheckoutForm.tsx\n${ACME}/src/checkout/AddressFields.tsx\n${ACME}/src/checkout/useCheckout.ts\n${ACME}/src/checkout/types.ts`);
  s.tool("Read", { file_path: `${ACME}/src/checkout/types.ts` }, `     1\texport interface CheckoutValues {\n     2\t  email: string;\n     3\t  name: string;\n     4\t  line1: string;\n     5\t  city: string;\n     6\t  postcode: string;\n     7\t  country: string;\n     8\t  cardNumber: string;\n     9\t  expiry: string;\n    10\t  cvc: string;\n    11\t}`);
  s.write(
    `${ACME}/src/checkout/schema.ts`,
    `import { z } from "zod";

const luhn = (digits: string): boolean => {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double && (d *= 2) > 9) d -= 9;
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
};

export const checkoutSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  name: z.string().min(2, "Enter the name on the card"),
  line1: z.string().min(3, "Enter your street address"),
  city: z.string().min(1, "Enter your city"),
  postcode: z.string().regex(/^[A-Z0-9 -]{3,10}$/i, "Enter a valid postcode"),
  country: z.string().length(2),
  cardNumber: z
    .string()
    .transform((v) => v.replace(/\\s+/g, ""))
    .refine((v) => /^\\d{16}$/.test(v) && luhn(v), "Enter a valid 16-digit card number"),
  expiry: z.string().regex(/^(0[1-9]|1[0-2])\\/\\d{2}$/, "Use MM/YY"),
  cvc: z.string().regex(/^\\d{3,4}$/, "3 or 4 digits"),
});

export type CheckoutInput = z.input<typeof checkoutSchema>;
`,
  );
  s.tool("Read", { file_path: `${ACME}/src/checkout/CheckoutForm.tsx`, offset: 40, limit: 12 }, `    40\t  const onSubmit = async (e: React.FormEvent) => {\n    41\t    e.preventDefault();\n    42\t    setSubmitting(true);\n    43\t    try {\n    44\t      await submitCheckout(values);\n    45\t    } finally {\n    46\t      setSubmitting(false);\n    47\t    }\n    48\t  };\n    49\t\n    50\t  return (\n    51\t    <form onSubmit={onSubmit} noValidate>`);
  s.edit(
    `${ACME}/src/checkout/CheckoutForm.tsx`,
    `    e.preventDefault();
    setSubmitting(true);
    try {
      await submitCheckout(values);`,
    `    e.preventDefault();
    const parsed = checkoutSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await submitCheckout(parsed.data);`,
  );
  s.edit(`${ACME}/src/checkout/CheckoutForm.tsx`, `import { submitCheckout } from "./useCheckout";`, `import { submitCheckout } from "./useCheckout";
import { checkoutSchema } from "./schema";
import { FieldError } from "../ui/FieldError";`);
  s.bash("pnpm typecheck && pnpm vitest run src/checkout", "Typecheck and run checkout tests", " ✓ src/checkout/schema.test.ts (6 tests) 22ms\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)");
  s.say(`Validation is in. The schema lives in \`src/checkout/schema.ts\` and the form shows a \`FieldError\` under each field on submit. Card numbers are checked with Luhn, so a typo in one digit is caught before the request.

Should errors also clear as the person types, or only on the next submit?`);
  s.user("Clear on change, please. And a test for the luhn check with a known-bad number.", 70);
  s.edit(`${ACME}/src/checkout/CheckoutForm.tsx`, `  const onChange = (field: keyof CheckoutValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [field]: e.target.value }));`, `  const onChange = (field: keyof CheckoutValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [field]: e.target.value }));
    setErrors((errs) => (field in errs ? { ...errs, [field]: undefined } : errs));`);
  s.edit(`${ACME}/src/checkout/schema.test.ts`, `describe("checkoutSchema", () => {`, `describe("checkoutSchema", () => {
  it("rejects a card number that fails the Luhn check", () => {
    const r = checkoutSchema.safeParse({ ...valid, cardNumber: "4242 4242 4242 4243" });
    expect(r.success).toBe(false);
  });
`);
  s.bash("pnpm vitest run src/checkout", "Run checkout tests", " ✓ src/checkout/schema.test.ts (7 tests) 25ms\n\n Test Files  1 passed (1)\n      Tests  7 passed (7)");
  s.say("Errors now clear per field as soon as it changes, and the Luhn test is in with `4242 4242 4242 4243`, which is one digit off the Stripe test card. Seven tests pass.");
  return s;
}

function zustandSession() {
  const s = new Session({ cwd: ACME, branch: "refactor/cart-store", startAt: NOW - 4 * DAY - 6 * HOUR, title: "Migrate cart to Zustand" });
  s.user("The cart context re-renders the whole header on every quantity change. Move the cart state to a Zustand store with selectors. Keep the public hook name useCart so call sites do not change.", 0);
  s.think("CartContext exposes items, add, remove, setQuantity and a derived total. A store with the same shape plus a useCart wrapper that accepts a selector keeps the call sites intact.", "I'll check how many call sites use the context and what they read from it.");
  s.tool("Grep", { pattern: "useCart\\(", path: `${ACME}/src`, output_mode: "count" }, `${ACME}/src/components/Header.tsx:1\n${ACME}/src/components/CartDrawer.tsx:1\n${ACME}/src/components/ProductCard.tsx:1\n${ACME}/src/checkout/useCheckout.ts:1\n${ACME}/src/pages/cart.tsx:1`);
  s.tool("Read", { file_path: `${ACME}/src/cart/CartContext.tsx` }, `     1\timport { createContext, useContext, useMemo, useState } from "react";\n     2\timport type { CartItem } from "./types";\n     3\t\n     4\tinterface CartApi {\n     5\t  items: CartItem[];\n     6\t  add: (item: CartItem) => void;\n     7\t  remove: (sku: string) => void;\n     8\t  setQuantity: (sku: string, qty: number) => void;\n     9\t  total: number;\n    10\t}\n    11\t\n    12\tconst CartContext = createContext<CartApi | null>(null);\n    13\t\n    14\texport function useCart(): CartApi {\n    15\t  const api = useContext(CartContext);\n    16\t  if (!api) throw new Error("useCart outside CartProvider");\n    17\t  return api;\n    18\t}`);
  s.bash("pnpm add zustand@5.0.8", "Install zustand", "Packages: +1\n+\nProgress: resolved 412, reused 411, downloaded 1, added 1, done\n\ndependencies:\n+ zustand 5.0.8");
  s.write(
    `${ACME}/src/cart/store.ts`,
    `import { create } from "zustand";
import type { CartItem } from "./types";

interface CartState {
  items: CartItem[];
  add: (item: CartItem) => void;
  remove: (sku: string) => void;
  setQuantity: (sku: string, qty: number) => void;
}

export const useCartStore = create<CartState>((set) => ({
  items: [],
  add: (item) =>
    set((s) => {
      const existing = s.items.find((i) => i.sku === item.sku);
      if (!existing) return { items: [...s.items, item] };
      return { items: s.items.map((i) => (i.sku === item.sku ? { ...i, qty: i.qty + item.qty } : i)) };
    }),
  remove: (sku) => set((s) => ({ items: s.items.filter((i) => i.sku !== sku) })),
  setQuantity: (sku, qty) =>
    set((s) => ({ items: qty <= 0 ? s.items.filter((i) => i.sku !== sku) : s.items.map((i) => (i.sku === sku ? { ...i, qty } : i)) })),
}));

export const selectTotal = (s: CartState): number => s.items.reduce((sum, i) => sum + i.price * i.qty, 0);
export const selectCount = (s: CartState): number => s.items.reduce((sum, i) => sum + i.qty, 0);

/** Same name as the old context hook. Pass a selector to subscribe to one slice. */
export function useCart<T = CartState>(selector: (s: CartState) => T = (s) => s as unknown as T): T {
  return useCartStore(selector);
}
`,
  );
  s.edit(`${ACME}/src/components/Header.tsx`, `  const { items } = useCart();
  const count = items.reduce((n, i) => n + i.qty, 0);`, `  const count = useCart(selectCount);`);
  s.edit(`${ACME}/src/components/Header.tsx`, `import { useCart } from "../cart/CartContext";`, `import { selectCount, useCart } from "../cart/store";`);
  s.bash("pnpm typecheck", "Type-check after the store swap", `src/components/CartDrawer.tsx:4:25 - error TS2307: Cannot find module '../cart/CartContext' or its corresponding type declarations.\nsrc/pages/cart.tsx:3:25 - error TS2307: Cannot find module '../cart/CartContext' or its corresponding type declarations.\n\nFound 2 errors.`, { isError: true });
  s.say("Two call sites still import the old module. The rest of the API is identical, so these are import swaps.");
  s.edit(`${ACME}/src/components/CartDrawer.tsx`, `import { useCart } from "../cart/CartContext";`, `import { useCart } from "../cart/store";`);
  s.edit(`${ACME}/src/pages/cart.tsx`, `import { useCart } from "../cart/CartContext";`, `import { useCart } from "../cart/store";`);
  s.bash("pnpm typecheck && pnpm vitest run", "Type-check and run the suite", " ✓ src/cart/store.test.ts (4 tests) 18ms\n ✓ src/checkout/schema.test.ts (7 tests) 24ms\n ✓ src/components/Header.test.tsx (3 tests) 96ms\n\n Test Files  3 passed (3)\n      Tests  14 passed (14)");
  s.say(`Done. The header now subscribes to \`selectCount\` only, so changing a quantity in the drawer no longer re-renders it. \`CartProvider\` can be removed from \`_app.tsx\` once you are happy; I left it in place so this change is purely additive.`);
  s.user("Remove the provider too, and delete CartContext.tsx.", 60);
  s.edit(`${ACME}/src/pages/_app.tsx`, `      <CartProvider>
        <Component {...pageProps} />
      </CartProvider>`, `      <Component {...pageProps} />`);
  s.bash("git rm -q src/cart/CartContext.tsx && pnpm typecheck", "Delete the old context and type-check", "");
  s.say("Provider removed and `CartContext.tsx` deleted. Typecheck is clean.");
  return s;
}

function playwrightSession() {
  const s = new Session({ cwd: ACME, branch: "main", startAt: NOW - 7 * DAY - 2 * HOUR, title: "Fix flaky Playwright tests" });
  s.user("checkout.spec.ts fails about one run in four on CI with 'locator.click: Target closed'. Passes locally every time. Can you find out why?", 0);
  s.tool("Read", { file_path: `${ACME}/e2e/checkout.spec.ts`, offset: 1, limit: 30 }, `     1\timport { expect, test } from "@playwright/test";\n     2\t\n     3\ttest("buys a hoodie", async ({ page }) => {\n     4\t  await page.goto("/products/hoodie-charcoal");\n     5\t  await page.getByRole("button", { name: "Add to cart" }).click();\n     6\t  await page.goto("/checkout");\n     7\t  await page.getByLabel("Email").fill("test@example.com");\n     8\t  await page.getByLabel("Card number").fill("4242 4242 4242 4242");\n     9\t  await page.getByRole("button", { name: "Pay" }).click();\n    10\t  await expect(page.getByText("Thanks for your order")).toBeVisible();\n    11\t});`);
  s.bash("gh run list --workflow e2e.yml --limit 20 --json conclusion,databaseId | jq -r '.[] | \"\\(.databaseId) \\(.conclusion)\"'", "List recent e2e runs", "11822041 failure\n11821930 success\n11821388 success\n11820672 failure\n11819904 success\n11819511 success\n11818877 success\n11818203 failure");
  s.bash("gh run view 11822041 --log-failed | grep -B2 -A8 'Target closed' | head -40", "Read the failed step log", "  5 |   await page.getByRole(\"button\", { name: \"Add to cart\" }).click();\n  6 |   await page.goto(\"/checkout\");\n> 7 |   await page.getByLabel(\"Email\").fill(\"test@example.com\");\n    |                                   ^\nError: locator.fill: Target page, context or browser has been closed\n\n  [chromium] › checkout.spec.ts:3:1 › buys a hoodie\n  pw:api <= page.goto succeeded (navigation to /checkout)\n  pw:api => page.goto started (navigation to /checkout?restored=1)");
  s.think("The second goto log line is the key: after /checkout loads, the app navigates again to /checkout?restored=1. The cart store rehydrates from localStorage asynchronously and the page replaces the URL, which tears down the locator's context mid-fill. Locally the rehydration is fast enough to finish before the fill.");
  s.say(`Found it. After \`/checkout\` loads, the cart store rehydrates from \`localStorage\` and the page calls \`router.replace("/checkout?restored=1")\`. On CI the rehydration finishes after the test has already started filling the form, so the navigation closes the locator's context mid-call.

The fix is in the app, not the test: the redirect should happen before paint, or not at all. The \`restored\` flag is only read by analytics.`);
  s.tool("Grep", { pattern: "restored=1", path: `${ACME}/src`, output_mode: "content" }, `${ACME}/src/pages/checkout.tsx:31:      router.replace("/checkout?restored=1");`);
  s.tool("Read", { file_path: `${ACME}/src/pages/checkout.tsx`, offset: 24, limit: 12 }, `    24\t  useEffect(() => {\n    25\t    if (hydrated) return;\n    26\t    const saved = localStorage.getItem("cart");\n    27\t    if (saved) {\n    28\t      restore(JSON.parse(saved));\n    29\t      track("cart_restored");\n    30\t      setHydrated(true);\n    31\t      router.replace("/checkout?restored=1");\n    32\t    }\n    33\t  }, [hydrated]);`);
  s.edit(`${ACME}/src/pages/checkout.tsx`, `      track("cart_restored");
      setHydrated(true);
      router.replace("/checkout?restored=1");`, `      track("cart_restored", { restored: true });
      setHydrated(true);`);
  s.edit(`${ACME}/e2e/checkout.spec.ts`, `  await page.goto("/checkout");
  await page.getByLabel("Email").fill("test@example.com");`, `  await page.goto("/checkout");
  await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  await page.getByLabel("Email").fill("test@example.com");`);
  s.bash("for i in 1 2 3 4 5 6 7 8; do pnpm exec playwright test e2e/checkout.spec.ts --reporter=line --workers=1 || break; done", "Run the spec eight times", "Running 1 test using 1 worker\n  1 passed (4.1s)\nRunning 1 test using 1 worker\n  1 passed (3.9s)\nRunning 1 test using 1 worker\n  1 passed (4.0s)\nRunning 1 test using 1 worker\n  1 passed (4.2s)\nRunning 1 test using 1 worker\n  1 passed (3.8s)\nRunning 1 test using 1 worker\n  1 passed (4.0s)\nRunning 1 test using 1 worker\n  1 passed (4.1s)\nRunning 1 test using 1 worker\n  1 passed (3.9s)");
  s.say("Eight consecutive passes. The `restored` query parameter moved into the analytics event payload, and the spec now waits for the heading before touching the form. Nothing else reads the parameter.");
  return s;
}

function darkModeSession() {
  const s = new Session({ cwd: ACME, branch: "feat/dark-grid", startAt: NOW - 12 * DAY - 5 * HOUR, title: "Dark mode for product grid" });
  s.user("Product cards look wrong in dark mode: white card background on a dark page, and the sale badge disappears. Fix the grid and cards using the existing theme tokens.", 0);
  s.tool("Read", { file_path: `${ACME}/src/styles/tokens.css`, offset: 1, limit: 24 }, `     1\t:root {\n     2\t  --surface: #ffffff;\n     3\t  --surface-raised: #f7f7f8;\n     4\t  --text: #111214;\n     5\t  --text-muted: #5c6066;\n     6\t  --accent: #d97757;\n     7\t  --sale: #c62828;\n     8\t  --sale-text: #ffffff;\n     9\t  --border: #e3e4e8;\n    10\t}\n    11\t\n    12\t@media (prefers-color-scheme: dark) {\n    13\t  :root {\n    14\t    --surface: #141518;\n    15\t    --surface-raised: #1e2024;\n    16\t    --text: #ecedef;\n    17\t    --text-muted: #9a9ea6;\n    18\t    --border: #2a2d33;\n    19\t  }\n    20\t}`);
  s.tool("Grep", { pattern: "#fff|#ffffff|white", path: `${ACME}/src/components/ProductCard.module.css`, output_mode: "content", "-n": true }, `3:  background: #fff;\n21:  color: white;\n27:  background: #fff;`);
  s.tool("Read", { file_path: `${ACME}/src/components/ProductCard.module.css` }, `     1\t.card {\n     2\t  border: 1px solid var(--border);\n     3\t  background: #fff;\n     4\t  border-radius: 12px;\n     5\t  overflow: hidden;\n     6\t}\n     7\t\n     8\t.image {\n     9\t  aspect-ratio: 4 / 5;\n    10\t  object-fit: cover;\n    11\t}\n    12\t\n    13\t.title {\n    14\t  font-weight: 600;\n    15\t}\n    16\t\n    17\t.badge {\n    18\t  position: absolute;\n    19\t  top: 12px;\n    20\t  left: 12px;\n    21\t  color: white;\n    22\t  background: var(--sale);\n    23\t}\n    24\t\n    25\t.price {\n    26\t  padding: 8px 12px;\n    27\t  background: #fff;\n    28\t}`);
  s.edit(`${ACME}/src/components/ProductCard.module.css`, `  border: 1px solid var(--border);
  background: #fff;`, `  border: 1px solid var(--border);
  background: var(--surface-raised);
  color: var(--text);`);
  s.edit(`${ACME}/src/components/ProductCard.module.css`, `  padding: 8px 12px;
  background: #fff;`, `  padding: 8px 12px;
  background: var(--surface-raised);`);
  s.edit(`${ACME}/src/components/ProductCard.module.css`, `  color: white;
  background: var(--sale);`, `  color: var(--sale-text);
  background: var(--sale);`);
  s.say("The badge was not disappearing because of its own colours; `.card` has `overflow: hidden` and the badge is positioned against the grid, not the card, so it was clipped once the card got a background. Adding `position: relative` to the card fixes that.");
  s.edit(`${ACME}/src/components/ProductCard.module.css`, `.card {
  border: 1px solid var(--border);`, `.card {
  position: relative;
  border: 1px solid var(--border);`);
  s.edit(`${ACME}/src/styles/tokens.css`, `    --border: #2a2d33;
  }`, `    --border: #2a2d33;
    --sale: #ef5350;
    --sale-text: #141518;
  }`);
  s.bash("pnpm exec playwright test e2e/visual/grid.spec.ts --update-snapshots", "Refresh grid visual snapshots", "Running 2 tests using 2 workers\n  2 passed (6.4s)\n  2 snapshots updated");
  s.say("Cards use `--surface-raised` and `--text`, the badge uses `--sale-text`, and dark mode gets a lighter red that passes contrast on the dark surface. Visual snapshots for light and dark are updated; have a look at the diff in the PR before merging.");
  return s;
}

function depBumpSession() {
  const s = new Session({ cwd: ACME, branch: "chore/deps-week-41", startAt: NOW - 19 * DAY - 4 * HOUR, title: "Weekly dependency bump" });
  s.user("Weekly deps. Bump everything minor and patch, run the suite, and tell me what you skipped.", 0);
  s.bash("pnpm outdated --format list", "List outdated packages", "@playwright/test 1.49.1 => 1.50.0\n@types/node 22.10.1 => 22.10.5\nnext 15.1.2 => 15.1.6\nstripe 17.4.0 => 17.5.0\ntypescript 5.7.2 => 5.7.3\nvitest 2.1.8 => 3.0.4\nzod 3.24.1 => 3.24.2");
  s.say("Vitest 3 is a major, so I'll leave it out and note it. Everything else is minor or patch.");
  s.bash("pnpm update @playwright/test @types/node next stripe typescript zod", "Update minor and patch versions", "Packages: +6 -6\nProgress: resolved 418, reused 412, downloaded 6, added 6, done\n\ndevDependencies:\n- @playwright/test 1.49.1\n+ @playwright/test 1.50.0\n- @types/node 22.10.1\n+ @types/node 22.10.5\n- typescript 5.7.2\n+ typescript 5.7.3\n\ndependencies:\n- next 15.1.2\n+ next 15.1.6\n- stripe 17.4.0\n+ stripe 17.5.0\n- zod 3.24.1\n+ zod 3.24.2");
  s.bash("pnpm typecheck && pnpm vitest run && pnpm exec playwright test", "Type-check, unit tests and e2e", " ✓ src/cart/store.test.ts (4 tests)\n ✓ src/checkout/schema.test.ts (7 tests)\n ✓ src/components/Header.test.tsx (3 tests)\n ✓ tests/webhooks/stripe.test.ts (2 tests)\n\n Test Files  4 passed (4)\n      Tests  16 passed (16)\n\nRunning 9 tests using 4 workers\n  9 passed (31.2s)");
  s.bash("pnpm exec playwright install chromium", "Install the browser build that playwright 1.50 expects", "Downloading Chromium 133.0.6943.16 (playwright build v1155)\nChromium 133.0.6943.16 downloaded to ~/Library/Caches/ms-playwright/chromium-1155");
  s.say(`Bumped six packages, all green.

Skipped:
- \`vitest\` 2.1.8 to 3.0.4 is a major. The changelog mentions changes to \`vi.mock\` hoisting and the default pool, which touch our webhook mocks. Worth its own PR.

One note: Playwright 1.50 wants a newer Chromium build, which I installed locally. CI installs browsers in the workflow, so no change needed there.`);
  return s;
}

/* --------------------------------------------------------------------------------------- */
/* notes-app                                                                                */
/* --------------------------------------------------------------------------------------- */

const NOTES = "/Users/demo/code/notes-app";

function markdownPreviewSession() {
  const s = new Session({ cwd: NOTES, branch: "main", startAt: NOW - 2 * DAY - 7 * HOUR, title: "Markdown preview toggle" });
  s.user("Add a preview toggle to the editor: Cmd+Shift+P flips between the raw markdown and a rendered view. Remember the choice per note.", 0);
  s.tool("Glob", { pattern: "src/editor/*.tsx", path: NOTES }, `${NOTES}/src/editor/Editor.tsx\n${NOTES}/src/editor/Toolbar.tsx\n${NOTES}/src/editor/useShortcuts.ts`);
  s.tool("Read", { file_path: `${NOTES}/src/editor/useShortcuts.ts` }, `     1\timport { useEffect } from "react";\n     2\t\n     3\texport function useShortcuts(map: Record<string, () => void>): void {\n     4\t  useEffect(() => {\n     5\t    const onKey = (e: KeyboardEvent) => {\n     6\t      const combo = [e.metaKey && "meta", e.shiftKey && "shift", e.key.toLowerCase()].filter(Boolean).join("+");\n     7\t      map[combo]?.();\n     8\t    };\n     9\t    window.addEventListener("keydown", onKey);\n    10\t    return () => window.removeEventListener("keydown", onKey);\n    11\t  }, [map]);\n    12\t}`);
  s.say("The shortcut hook already handles meta and shift, so the toggle is a new entry in the map plus a `preview` flag stored with the note's settings.");
  s.edit(`${NOTES}/src/editor/Editor.tsx`, `  useShortcuts({ "meta+s": save });`, `  const [preview, setPreview] = useNoteSetting(note.id, "preview", false);
  useShortcuts({ "meta+s": save, "meta+shift+p": () => setPreview((p) => !p) });`);
  s.edit(`${NOTES}/src/editor/Editor.tsx`, `      <textarea value={note.body} onChange={(e) => update(e.target.value)} />`, `      {preview ? <Preview markdown={note.body} /> : <textarea value={note.body} onChange={(e) => update(e.target.value)} />}`);
  s.write(`${NOTES}/src/editor/Preview.tsx`, `import { marked } from "marked";
import DOMPurify from "dompurify";

export function Preview({ markdown }: { markdown: string }) {
  const html = DOMPurify.sanitize(marked.parse(markdown, { async: false }) as string);
  return <article className="preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
`);
  s.bash("pnpm typecheck", "Type-check", "");
  s.say("Toggle is wired to Cmd+Shift+P and the choice is saved per note through `useNoteSetting`. Rendered HTML goes through DOMPurify since notes can be pasted from anywhere.");
  s.user("Nice. Add a button in the toolbar too, some people will never find the shortcut.", 50);
  s.edit(`${NOTES}/src/editor/Toolbar.tsx`, `      <button onClick={onSave} title="Save (Cmd+S)">Save</button>`, `      <button onClick={onSave} title="Save (Cmd+S)">Save</button>
      <button onClick={onTogglePreview} aria-pressed={preview} title="Preview (Cmd+Shift+P)">
        {preview ? "Edit" : "Preview"}
      </button>`);
  s.say("Added a Preview button next to Save; it reads Edit while the preview is open, with `aria-pressed` for screen readers.");
  return s;
}

function syncConflictsSession() {
  const s = new Session({ cwd: NOTES, branch: "fix/sync-conflicts", startAt: NOW - 9 * DAY - 3 * HOUR, title: "Sync conflicts on reconnect" });
  s.user("When the laptop comes back online after editing offline, the server copy overwrites local changes. Users lose text. I want last-writer-wins replaced with a three-way merge for the note body.", 0);
  s.think("The sync code pushes local notes, then pulls the server list and replaces local rows. The base version needed for a three-way merge must be stored at the time of the last successful sync.", "I'll check what the sync loop stores today and whether a base revision exists.");
  s.tool("Read", { file_path: `${NOTES}/src/sync/sync.ts`, offset: 18, limit: 22 }, `    18\texport async function syncOnce(): Promise<void> {\n    19\t  const local = await db.notes.toArray();\n    20\t  const dirty = local.filter((n) => n.dirty);\n    21\t  for (const n of dirty) await api.putNote(n);\n    22\t  const remote = await api.listNotes();\n    23\t  await db.transaction("rw", db.notes, async () => {\n    24\t    for (const r of remote) await db.notes.put({ ...r, dirty: false });\n    25\t  });\n    26\t}`);
  s.say("There is no base revision, so a merge is impossible today. The plan: store `syncedBody` on every successful push or pull, and on pull merge `syncedBody`, local `body` and remote `body` with a line-based diff3. Conflicts that cannot be resolved automatically keep both versions with markers, which is what git does and what users already understand.");
  s.bash("pnpm add node-diff3@3.1.2", "Install a diff3 implementation", "Packages: +1\nProgress: resolved 233, reused 232, downloaded 1, added 1, done\n\ndependencies:\n+ node-diff3 3.1.2");
  s.write(`${NOTES}/src/sync/merge.ts`, `import { diff3Merge } from "node-diff3";

export interface MergeResult {
  body: string;
  conflicted: boolean;
}

/** Three-way merge of note bodies, line by line. Conflicts keep both sides with markers. */
export function mergeBodies(base: string, local: string, remote: string): MergeResult {
  if (local === remote) return { body: local, conflicted: false };
  if (local === base) return { body: remote, conflicted: false };
  if (remote === base) return { body: local, conflicted: false };
  const out: string[] = [];
  let conflicted = false;
  for (const region of diff3Merge(local.split("\\n"), base.split("\\n"), remote.split("\\n"))) {
    if (region.ok) {
      out.push(...region.ok);
    } else if (region.conflict) {
      conflicted = true;
      out.push("<<<<<<< this device", ...region.conflict.a, "=======", ...region.conflict.b, ">>>>>>> server");
    }
  }
  return { body: out.join("\\n"), conflicted };
}
`);
  s.edit(`${NOTES}/src/sync/sync.ts`, `  await db.transaction("rw", db.notes, async () => {
    for (const r of remote) await db.notes.put({ ...r, dirty: false });
  });`, `  await db.transaction("rw", db.notes, async () => {
    for (const r of remote) {
      const l = local.find((n) => n.id === r.id);
      if (!l || !l.dirty) {
        await db.notes.put({ ...r, dirty: false, syncedBody: r.body });
        continue;
      }
      const m = mergeBodies(l.syncedBody ?? "", l.body, r.body);
      await db.notes.put({ ...r, body: m.body, dirty: true, conflicted: m.conflicted, syncedBody: r.body });
    }
  });`);
  s.write(`${NOTES}/src/sync/merge.test.ts`, `import { describe, expect, it } from "vitest";
import { mergeBodies } from "./merge";

describe("mergeBodies", () => {
  it("keeps edits on different lines from both sides", () => {
    const base = "a\\nb\\nc";
    const r = mergeBodies(base, "A\\nb\\nc", "a\\nb\\nC");
    expect(r).toEqual({ body: "A\\nb\\nC", conflicted: false });
  });

  it("marks a conflict when both sides change the same line", () => {
    const r = mergeBodies("a\\nb", "a\\nlocal", "a\\nremote");
    expect(r.conflicted).toBe(true);
    expect(r.body).toContain("<<<<<<< this device");
  });
});
`);
  s.bash("pnpm vitest run src/sync", "Run the sync tests", " ✓ src/sync/merge.test.ts (2 tests) 9ms\n\n Test Files  1 passed (1)\n      Tests  2 passed (2)");
  s.say("Merge is in. Dirty local notes are merged against the stored `syncedBody` instead of being overwritten, and conflicted notes keep both versions with markers plus a `conflicted` flag you can surface in the list. The next push sends the merged body, so the server never sees a silent overwrite either.");
  return s;
}

function pdfExportSession() {
  const s = new Session({ cwd: NOTES, branch: "main", startAt: NOW - 16 * DAY - 1 * HOUR, title: "Export notes as PDF" });
  s.user("Add an 'Export as PDF' item to the note menu. Use the browser's print path rather than a PDF library, I do not want another 2 MB dependency.", 0);
  s.tool("Grep", { pattern: "Export as", path: `${NOTES}/src`, output_mode: "content" }, `${NOTES}/src/notes/NoteMenu.tsx:22:        <MenuItem onSelect={() => exportMarkdown(note)}>Export as Markdown</MenuItem>`);
  s.edit(`${NOTES}/src/notes/NoteMenu.tsx`, `        <MenuItem onSelect={() => exportMarkdown(note)}>Export as Markdown</MenuItem>`, `        <MenuItem onSelect={() => exportMarkdown(note)}>Export as Markdown</MenuItem>
        <MenuItem onSelect={() => exportPdf(note)}>Export as PDF</MenuItem>`);
  s.write(`${NOTES}/src/notes/exportPdf.ts`, `import { renderMarkdown } from "../editor/render";
import type { Note } from "./types";

/** Opens the rendered note in a hidden frame and triggers the print dialog, where "Save as PDF" lives. */
export function exportPdf(note: Note): void {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(\`<!doctype html><title>\${note.title}</title><link rel="stylesheet" href="/print.css"><article>\${renderMarkdown(note.body)}</article>\`);
  doc.close();
  frame.contentWindow!.addEventListener("afterprint", () => frame.remove());
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
}
`);
  s.write(`${NOTES}/public/print.css`, `@page { margin: 20mm; }
body { font: 11pt/1.5 Georgia, serif; color: #000; }
article { max-width: 160mm; margin: 0 auto; }
pre { white-space: pre-wrap; font-size: 9.5pt; }
h1 { page-break-after: avoid; }
`);
  s.bash("pnpm typecheck", "Type-check", "");
  s.say("Export as PDF opens the rendered note in a hidden frame with a print stylesheet and calls `print()`. Safari, Chrome and Firefox all offer Save as PDF there, and the frame removes itself after printing. No new dependency.");
  return s;
}

/* --------------------------------------------------------------------------------------- */
/* dotfiles                                                                                 */
/* --------------------------------------------------------------------------------------- */

const DOTS = "/Users/demo/dotfiles";

function tmuxSession() {
  const s = new Session({ cwd: DOTS, branch: "main", startAt: NOW - 5 * DAY - 9 * HOUR, title: "Tmux status line tweaks" });
  s.user("My tmux status line shows the full hostname and the clock with seconds, which is noise. Show the short hostname, the git branch of the current pane's directory, and the time as HH:MM.", 0);
  s.tool("Read", { file_path: `${DOTS}/tmux/tmux.conf`, offset: 30, limit: 8 }, `    30\tset -g status-interval 1\n    31\tset -g status-left "#S "\n    32\tset -g status-right "#H %H:%M:%S"\n    33\tset -g status-style "bg=#1e2024,fg=#9a9ea6"`);
  s.write(`${DOTS}/tmux/git-branch.sh`, `#!/bin/sh
# Prints the branch of the git repo at $1, or nothing. Used by the tmux status line.
dir="\${1:-.}"
git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null
`);
  s.bash("chmod +x ~/dotfiles/tmux/git-branch.sh", "Make the helper executable", "");
  s.edit(`${DOTS}/tmux/tmux.conf`, `set -g status-interval 1
set -g status-left "#S "
set -g status-right "#H %H:%M:%S"`, `set -g status-interval 5
set -g status-left "#S "
set -g status-right "#(~/dotfiles/tmux/git-branch.sh '#{pane_current_path}') #h %H:%M"`);
  s.bash("tmux source-file ~/dotfiles/tmux/tmux.conf && tmux display -p '#{status-right}'", "Reload tmux and print the status-right format", "#(~/dotfiles/tmux/git-branch.sh '#{pane_current_path}') #h %H:%M");
  s.say("Done. `#h` is the short hostname, the branch comes from a small helper script so it works outside git repos without errors, and the interval went from 1s to 5s since nothing on the line changes faster than that.");
  return s;
}

function starshipSession() {
  const s = new Session({ cwd: DOTS, branch: "main", startAt: NOW - 26 * DAY - 2 * HOUR, title: "Switch zsh prompt to starship" });
  s.user("Replace my hand-rolled zsh prompt with starship. Keep it one line, show the directory, git branch and status, and the node version only inside node projects.", 0);
  s.tool("Grep", { pattern: "PROMPT=|precmd", path: `${DOTS}/zsh`, output_mode: "content", "-n": true }, `${DOTS}/zsh/prompt.zsh:4:precmd() { vcs_info }\n${DOTS}/zsh/prompt.zsh:9:PROMPT='%F{blue}%~%f \${vcs_info_msg_0_} %F{yellow}❯%f '`);
  s.bash("brew install starship", "Install starship", "==> Downloading https://ghcr.io/v2/homebrew/core/starship/manifests/1.21.1\n==> Pouring starship--1.21.1.arm64_sequoia.bottle.tar.gz\n🍺  /opt/homebrew/Cellar/starship/1.21.1: 9 files, 9.4MB");
  s.write(`${DOTS}/starship.toml`, `add_newline = false
format = "$directory$git_branch$git_status$nodejs$character"

[directory]
truncation_length = 3
style = "blue"

[git_branch]
format = "[$branch]($style) "
style = "purple"

[git_status]
format = "([$all_status$ahead_behind]($style) )"
style = "yellow"

[nodejs]
format = "[$symbol($version )]($style)"
detect_files = ["package.json"]
detect_folders = ["node_modules"]

[character]
success_symbol = "[❯](yellow)"
error_symbol = "[❯](red)"
`);
  s.edit(`${DOTS}/zsh/zshrc`, `source ~/dotfiles/zsh/prompt.zsh`, `export STARSHIP_CONFIG=~/dotfiles/starship.toml
eval "$(starship init zsh)"`);
  s.bash("git rm -q zsh/prompt.zsh && zsh -ic 'starship prompt' | cat -v | head -3", "Remove the old prompt and render the new one once", "^[[34m~/dotfiles^[[0m ^[[35mmain^[[0m ^[[33m❯^[[0m ");
  s.say("Starship is in with a single-line prompt: directory, branch, status and the node version only where a `package.json` or `node_modules` is found. The old `prompt.zsh` is removed and `zshrc` sources starship instead.");
  s.user("Can the directory truncate to the repo root instead of 3 segments?", 45);
  s.edit(`${DOTS}/starship.toml`, `truncation_length = 3
style = "blue"`, `truncation_length = 3
truncate_to_repo = true
style = "blue"`);
  s.say("Yes, `truncate_to_repo = true` does exactly that: inside a repo the path starts at the repo root, elsewhere it falls back to three segments.");
  return s;
}

/* --------------------------------------------------------------------------------------- */

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(PROJECTS, { recursive: true });
fs.mkdirSync(SESSIONS, { recursive: true });

const sessions = [
  richStripeSession(),
  checkoutValidationSession(),
  zustandSession(),
  playwrightSession(),
  darkModeSession(),
  depBumpSession(),
  markdownPreviewSession(),
  syncConflictsSession(),
  pdfExportSession(),
  tmuxSession(),
  starshipSession(),
];

const rows = [];
for (const s of sessions) {
  const file = s.writeTo(PROJECTS);
  rows.push({ project: path.basename(s.cwd), title: s.title, turns: s.turns, agents: s.agents.length, ended: new Date(s.t).toISOString(), file: path.relative(OUT, file) });
}
// The newest session's log looks freshly written, so the tree may show a "recently ended" dot.
fs.utimesSync(path.join(OUT, rows[0].file), NOW / 1000, NOW / 1000);
console.table(rows);
console.log(`\nWrote ${sessions.length} sessions under ${PROJECTS}`);
