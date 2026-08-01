import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { acquireLock, loadSession, saveSession } from "../src/core/session.ts";
import { grantExemption } from "../src/core/policy.ts";
import { canonicalize } from "../src/core/canonicalize.ts";

test("global exemptions merge into active sessions", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-exempt-"));
  process.env.CANARYWATCH_HOME = tmpHome;

  // Grant exemption to 'global'
  const globalState = loadSession("global");
  grantExemption(globalState, ".env", "read", false);
  saveSession(globalState);

  // Load a brand-new session
  const sessionState = loadSession("active-session-1");
  assert.ok(sessionState.exemptions.length >= 1);
  assert.equal(sessionState.exemptions[0].scope, canonicalize(".env"));

  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test("atomic state writes and lock acquisition", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-lock-"));
  process.env.CANARYWATCH_HOME = tmpHome;

  const sessionId = "concurrent-session";
  const release = acquireLock(sessionId);

  const state = loadSession(sessionId);
  state.scopeViolations += 1;
  saveSession(state);

  release();

  const reloaded = loadSession(sessionId);
  assert.equal(reloaded.scopeViolations, 1);

  fs.rmSync(tmpHome, { recursive: true, force: true });
});
