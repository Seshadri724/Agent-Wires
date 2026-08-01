import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { isSubpathOrEqual } from "../src/core/canonicalize.ts";
import { evaluate } from "../src/core/policy.ts";
import { DEFAULT_POLICY } from "../src/core/types.ts";
import type { SessionState, ToolCallEvent } from "../src/core/types.ts";

test("path boundary check prevents sibling path bypass", () => {
  const projectRoot = path.resolve("/workspace/project");
  const siblingPath = path.resolve("/workspace/project-secrets/keys.txt");
  const childPath = path.resolve("/workspace/project/src/index.ts");

  assert.equal(isSubpathOrEqual(projectRoot, childPath), true, "Subpath inside project root must match");
  assert.equal(isSubpathOrEqual(projectRoot, siblingPath), false, "Sibling path with same prefix MUST NOT match");
  assert.equal(isSubpathOrEqual(projectRoot, projectRoot), true, "Exact match must match");
});

test("scope evaluation enforces path boundary checks", () => {
  const state: SessionState = {
    sessionId: "scope-test-session",
    scopeRoots: [path.resolve("/workspace/my-app")],
    writeTimestamps: [],
    scopeViolations: 0,
    locked: false,
    exemptions: [],
  };

  const siblingEvent: ToolCallEvent = {
    kind: "tool_call",
    sessionId: "scope-test-session",
    tool: "Write",
    paths: [{ path: path.resolve("/workspace/my-app-secrets/env.txt"), access: "write", confidence: "exact" }],
    phase: "pre",
    ts: Date.now(),
  };

  const decision = evaluate(siblingEvent, DEFAULT_POLICY, new Set<string>(), state);
  assert.equal(decision.action, "warn");
  assert.equal(decision.detector, "D3");
});

test("D5 and D7 apply to generic MCP shell tools without leaking raw commands", () => {
  const state: SessionState = {
    sessionId: "mcp-shell-test",
    scopeRoots: [],
    writeTimestamps: [],
    scopeViolations: 0,
    locked: false,
    exemptions: [],
  };

  const d5Event: ToolCallEvent = {
    kind: "tool_call",
    sessionId: "mcp-shell-test",
    tool: "exec",
    paths: [],
    phase: "pre",
    raw: { command: "rm -rf / --secret-key=supersecret123" },
    ts: Date.now(),
  };

  const decision = evaluate(d5Event, DEFAULT_POLICY, new Set<string>(), state);
  assert.equal(decision.action, "pause");
  assert.equal(decision.detector, "D5");
  assert.equal(decision.reason.includes("supersecret123"), false, "Denial reason MUST NOT leak raw command text");
  assert.match(decision.reason, /Dangerous shell command pattern/);
});
