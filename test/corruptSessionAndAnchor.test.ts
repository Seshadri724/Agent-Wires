import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadSession } from "../src/core/session.ts";
import { appendEvent, verifyChain } from "../src/core/eventlog.ts";
import { canarywatchHome, eventLogPath } from "../src/core/home.ts";
import type { Decision } from "../src/core/types.ts";

test("corrupted session state file fails CLOSED (locked: true)", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-corruptsess-"));
  process.env.CANARYWATCH_HOME = tmpHome;

  const sessionId = "corrupt-session";
  const stateDir = path.join(tmpHome, "sessions");
  fs.mkdirSync(stateDir, { recursive: true });

  const sessionFile = path.join(stateDir, `${encodeURIComponent(sessionId)}.json`);
  // Write invalid/corrupt JSON content
  fs.writeFileSync(sessionFile, "{ invalid json content ... }");

  const loadedState = loadSession(sessionId);
  assert.equal(loadedState.locked, true, "Corrupted session file MUST fail closed (locked: true)");
  assert.equal(loadedState.scopeViolations, 99);

  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test("tampered or corrupted head.anchor.json causes verifyChain to fail", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-corruptanchor-"));
  process.env.CANARYWATCH_HOME = tmpHome;

  const decision: Decision = {
    action: "log",
    detector: "none",
    reason: "Step 1",
    evidence: { sessionId: "s1", tool: "Read", paths: ["file1.txt"], ts: Date.now() },
  };

  appendEvent(decision);

  // Verification on intact anchor must pass
  const validResult = verifyChain();
  assert.equal(validResult.valid, true);

  // Tamper with head.anchor.json HMAC signature
  const anchorPath = path.join(canarywatchHome(), "head.anchor.json");
  assert.ok(fs.existsSync(anchorPath));
  const rawAnchor = JSON.parse(fs.readFileSync(anchorPath, "utf8"));
  rawAnchor.hmac = "0".repeat(64); // Invalid HMAC
  fs.writeFileSync(anchorPath, JSON.stringify(rawAnchor));

  // Verification MUST fail on tampered head anchor
  const tamperedResult = verifyChain();
  assert.equal(tamperedResult.valid, false, "Tampered head anchor MUST fail verification");
  assert.match(tamperedResult.reason || "", /signature verification failed/i);

  // Write corrupted non-JSON to anchor file
  fs.writeFileSync(anchorPath, "CORRUPT NON-JSON");
  const corruptResult = verifyChain();
  assert.equal(corruptResult.valid, false, "Corrupted head anchor file MUST fail verification");
  assert.match(corruptResult.reason || "", /corrupt or unreadable/i);

  fs.rmSync(anchorPath);
  const missingResult = verifyChain();
  assert.equal(missingResult.valid, false, "A non-empty log without an anchor MUST fail verification");
  assert.match(missingResult.reason || "", /anchor is missing/i);
  assert.throws(() => appendEvent(decision), /invalid event log/);

  fs.writeFileSync(eventLogPath(), "not-json\n");
  const malformedLogResult = verifyChain();
  assert.equal(malformedLogResult.valid, false, "Malformed event data MUST fail verification");
  assert.match(malformedLogResult.reason || "", /corrupt or unreadable/i);

  fs.rmSync(tmpHome, { recursive: true, force: true });
});
