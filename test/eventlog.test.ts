import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Decision } from "../src/core/types.ts";

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cw-eventlog-"));
  process.env.CANARYWATCH_HOME = tmpHome;
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.CANARYWATCH_HOME;
});

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    action: "pause",
    detector: "D1",
    reason: "test",
    evidence: { sessionId: "s1", tool: "Read", paths: ["/x"], ts: Date.now() },
    ...overrides,
  };
}

describe("event log hash chain", () => {
  test("appended entries form a valid chain", async () => {
    const { appendEvent, verifyChain, readEvents } = await import("../src/core/eventlog.ts");
    appendEvent(decision());
    appendEvent(decision({ reason: "second" }));
    appendEvent(decision({ reason: "third" }));

    const events = readEvents();
    assert.equal(events.length, 3);
    assert.equal(events[0].seq, 0);
    assert.equal(events[2].prevHash, events[1].hash);

    const result = verifyChain();
    assert.equal(result.valid, true);
  });

  test("tampering with a past entry breaks verification", async () => {
    const { appendEvent, verifyChain } = await import("../src/core/eventlog.ts");
    const { eventLogPath } = await import("../src/core/home.ts");
    appendEvent(decision());
    appendEvent(decision({ reason: "second" }));

    const p = eventLogPath();
    const lines = fs.readFileSync(p, "utf8").trim().split("\n");
    const first = JSON.parse(lines[0]);
    first.decision.reason = "tampered";
    lines[0] = JSON.stringify(first);
    fs.writeFileSync(p, lines.join("\n") + "\n");

    const result = verifyChain();
    assert.equal(result.valid, false);
  });

  test("escalations() filters to pause/lockdown only", async () => {
    const { appendEvent, escalations } = await import("../src/core/eventlog.ts");
    appendEvent(decision({ action: "allow", detector: "none" }));
    appendEvent(decision({ action: "pause", detector: "D2" }));
    appendEvent(decision({ action: "warn", detector: "D3" }));
    appendEvent(decision({ action: "lockdown", detector: "none" }));

    const esc = escalations();
    assert.equal(esc.length, 2);
    assert.ok(esc.every((e) => e.decision.action === "pause" || e.decision.action === "lockdown"));
  });
});
