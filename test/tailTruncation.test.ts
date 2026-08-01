import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { appendEvent, verifyChain } from "../src/core/eventlog.ts";
import { eventLogPath } from "../src/core/home.ts";
import type { Decision } from "../src/core/types.ts";

test("tail truncation detection in verifyChain", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-truncation-"));
  process.env.CANARYWATCH_HOME = tmpHome;

  const decision1: Decision = {
    action: "log",
    detector: "none",
    reason: "Step 1",
    evidence: { sessionId: "s1", tool: "Read", paths: ["file1.txt"], ts: Date.now() },
  };

  const decision2: Decision = {
    action: "warn",
    detector: "D3",
    reason: "Step 2",
    evidence: { sessionId: "s1", tool: "Write", paths: ["file2.txt"], ts: Date.now() },
  };

  appendEvent(decision1);
  appendEvent(decision2);

  // Verification on intact log should pass
  const initialVerify = verifyChain();
  assert.equal(initialVerify.valid, true);

  // Simulate an attacker truncating the log file to remove the last entry
  const logFile = eventLogPath();
  const lines = fs.readFileSync(logFile, "utf8").split("\n").filter((l) => l.trim().length > 0);
  lines.pop(); // Remove tail entry
  fs.writeFileSync(logFile, lines.join("\n") + "\n");

  // Verification on truncated log MUST detect tail truncation via head anchor check
  const truncatedVerify = verifyChain();
  assert.equal(truncatedVerify.valid, false);
  assert.match(truncatedVerify.reason || "", /Tail truncation detected/);

  fs.rmSync(tmpHome, { recursive: true, force: true });
});
