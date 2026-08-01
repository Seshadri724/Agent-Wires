import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { extractPathClaims } from "../src/hook/pathClaims.ts";
import { loadSession } from "../src/core/session.ts";
import { evaluate } from "../src/core/policy.ts";
import { DEFAULT_POLICY } from "../src/core/types.ts";
import type { ToolCallEvent } from "../src/core/types.ts";

test("MCP generic tool path claim extraction", () => {
  const readClaims = extractPathClaims("filesystem.read_file", { path: ".env" });
  assert.equal(readClaims.length, 1);
  assert.equal(readClaims[0].path, ".env");
  assert.equal(readClaims[0].access, "read");

  const writeClaims = extractPathClaims("filesystem.write_file", { file_path: "secret.txt" });
  assert.equal(writeClaims.length, 1);
  assert.equal(writeClaims[0].path, "secret.txt");
  assert.equal(writeClaims[0].access, "write");

  const execClaims = extractPathClaims("exec", { command: "cat ~/.ssh/id_rsa" });
  assert.ok(execClaims.length >= 1);
  assert.equal(execClaims[0].access, "read");
});

test("MCP session locking persistence", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-mcplock-"));
  process.env.CANARYWATCH_HOME = tmpHome;

  const sessionId = "mcp-test-session";
  const state = loadSession(sessionId);
  assert.equal(state.locked, false);

  const event: ToolCallEvent = {
    kind: "tool_call",
    sessionId,
    tool: "filesystem.read_file",
    paths: [{ path: path.join(tmpHome, ".env"), access: "read", confidence: "exact" }],
    phase: "pre",
    raw: { path: ".env" },
    ts: Date.now(),
  };

  const manifestPaths = new Set<string>();
  const decision = evaluate(event, DEFAULT_POLICY, manifestPaths, state);

  if (decision.action === "pause" || decision.action === "lockdown") {
    state.locked = true;
  }

  assert.equal(decision.action, "pause");
  assert.equal(state.locked, true);

  // Follow-up evaluation against locked state must deny
  const followUpDecision = evaluate(event, DEFAULT_POLICY, manifestPaths, state);
  assert.equal(followUpDecision.action, "lockdown");

  fs.rmSync(tmpHome, { recursive: true, force: true });
});
