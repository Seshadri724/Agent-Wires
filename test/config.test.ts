import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPolicy, parsePolicyConfig, savePolicy } from "../src/core/config.ts";
import { DEFAULT_POLICY } from "../src/core/types.ts";

test("policy parser validates fields and merges valid partial policy with defaults", () => {
  const policy = parsePolicyConfig({ scopeEnforced: false, massMod: { threshold: 8 }, mcp: { blockedServers: ["blocked"] } });
  assert.equal(policy.scopeEnforced, false);
  assert.equal(policy.massMod.threshold, 8);
  assert.equal(policy.massMod.windowMs, DEFAULT_POLICY.massMod.windowMs);
  assert.deepEqual(policy.mcp, { blockedServers: ["blocked"] });
});

test("loadPolicy rejects valid JSON with invalid enforcement field types", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-invalid-policy-"));
  const previousHome = process.env.CANARYWATCH_HOME;
  process.env.CANARYWATCH_HOME = home;
  try {
    fs.writeFileSync(path.join(home, "policy.json"), JSON.stringify({
      scopeEnforced: "false",
      massMod: { threshold: 0 },
    }));
    assert.throws(() => loadPolicy(), /scopeEnforced must be a boolean/);
  } finally {
    if (previousHome === undefined) delete process.env.CANARYWATCH_HOME;
    else process.env.CANARYWATCH_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("savePolicy refuses invalid runtime values before writing them", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-save-policy-"));
  const previousHome = process.env.CANARYWATCH_HOME;
  process.env.CANARYWATCH_HOME = home;
  try {
    assert.throws(() => savePolicy({ ...DEFAULT_POLICY, scopeEnforced: "no" } as any), /scopeEnforced must be a boolean/);
    assert.equal(fs.existsSync(path.join(home, "policy.json")), false);
  } finally {
    if (previousHome === undefined) delete process.env.CANARYWATCH_HOME;
    else process.env.CANARYWATCH_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
