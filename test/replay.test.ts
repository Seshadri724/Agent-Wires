import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { appendEvent, exportEventsJson, exportEventsOcsf, getEventsForSession } from "../src/core/eventlog.ts";
import type { Decision } from "../src/core/types.ts";

test("session events and replay export", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-replay-"));
  process.env.CANARYWATCH_HOME = tmpDir;

  const decision: Decision = {
    action: "pause",
    detector: "D1",
    reason: "Canary touched",
    evidence: {
      sessionId: "replay-sess-1",
      tool: "Read",
      paths: [path.join(tmpDir, "canary.txt")],
      ts: Date.now(),
    },
  };

  appendEvent(decision);

  const sessionEvents = getEventsForSession("replay-sess-1");
  assert.equal(sessionEvents.length, 1);
  assert.equal(sessionEvents[0].decision.detector, "D1");

  const jsonExport = exportEventsJson("replay-sess-1");
  assert.match(jsonExport, /replay-sess-1/);
  assert.match(jsonExport, /Canary touched/);

  const ocsfExport = exportEventsOcsf("replay-sess-1");
  assert.match(ocsfExport, /Application Security Finding/);
  assert.match(ocsfExport, /replay-sess-1/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
