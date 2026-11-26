import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CANARYWATCH_HOOK_MARKER, resolveHookScript } from "../src/cli/commands/installHook.ts";
import { seed } from "../src/seeder/seeder.ts";
import { appendEvent } from "../src/core/eventlog.ts";

function invokeDoctor(home: string, state: string) {
  return spawnSync(process.execPath, [path.resolve("src/cli/cli.ts"), "doctor", "--json"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home, CANARYWATCH_HOME: state },
  });
}

test("doctor reports a healthy install as versioned JSON without changing state", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-doctor-home-"));
  const state = path.join(home, ".canarywatch");
  const configPath = path.join(home, ".claude", "settings.json");
  const hook = resolveHookScript();
  assert.ok(hook);
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(path.join(state, "policy.json"), "{}");
  fs.writeFileSync(configPath, JSON.stringify({ hooks: { PreToolUse: [{
    id: CANARYWATCH_HOOK_MARKER,
    hooks: [{ type: "command", command: `node "${hook}"` }],
  }] } }));

  try {
    const before = fs.readdirSync(state).sort();
    const result = invokeDoctor(home, state);
    const report = JSON.parse(result.stdout);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(report.schemaVersion, "1.0.0");
    assert.equal(report.passed, true);
    assert.ok(report.checks.every((check: { status: string }) => check.status === "pass"));
    assert.deepEqual(fs.readdirSync(state).sort(), before);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("doctor reports a missing or stale Claude hook as a failure", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-doctor-missing-"));
  const state = path.join(home, ".canarywatch");
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{
    id: CANARYWATCH_HOOK_MARKER,
    hooks: [{ type: "command", command: "node old-hook.cjs" }],
  }] } }));
  try {
    const result = invokeDoctor(home, state);
    const report = JSON.parse(result.stdout);
    assert.equal(result.status, 1);
    assert.equal(report.passed, false);
    assert.equal(report.checks.find((check: { name: string }) => check.name === "claude-hook").status, "fail");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("doctor rejects unknown options", () => {
  const result = spawnSync(process.execPath, [path.resolve("src/cli/cli.ts"), "doctor", "--fix"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown option --fix/);
});

test("doctor detects a policy with valid JSON but invalid field types", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-doctor-policy-"));
  const state = path.join(home, ".canarywatch");
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, "policy.json"), JSON.stringify({ scopeEnforced: "yes", massMod: { threshold: 0 } }));
  try {
    const result = invokeDoctor(home, state);
    const report = JSON.parse(result.stdout);
    assert.equal(result.status, 1);
    assert.equal(report.checks.find((check: { name: string }) => check.name === "policy-config").status, "fail");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("doctor distinguishes ready, not_seeded, missing, and unobserved without creating state", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-doctor-states-"));
  const state = path.join(home, "nonexistent-canarywatch");
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cw-doctor-ws-"));
  try {
    const missingResult = spawnSync(process.execPath, [path.resolve("src/cli/cli.ts"), "doctor", workspace], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home, CANARYWATCH_HOME: state },
    });
    assert.equal(missingResult.status, 1);
    assert.equal(fs.existsSync(state), false, "doctor must not create missing state directory");
    assert.match(missingResult.stdout, /MISSING/);
    assert.match(missingResult.stdout, /NOT SEEDED/);
    assert.match(missingResult.stdout, /UNOBSERVED/);
    assert.match(missingResult.stdout, /Next step: canarywatch init/);

    // Now seed workspace and add an event, verify seeded + integrity ready
    const prevHome = process.env.CANARYWATCH_HOME;
    process.env.CANARYWATCH_HOME = state;
    try {
      seed(workspace, "light");
      appendEvent({
        action: "pause",
        detector: "D2",
        reason: "Sensitive path accessed",
        evidence: { sessionId: "doc-s1", tool: "Read", paths: [path.join(workspace, ".env")], ts: Date.now() },
      });
    } finally {
      if (prevHome === undefined) delete process.env.CANARYWATCH_HOME;
      else process.env.CANARYWATCH_HOME = prevHome;
    }

    const hook = resolveHookScript();
    assert.ok(hook);
    const configPath = path.join(home, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        hooks: { PreToolUse: [{ id: CANARYWATCH_HOOK_MARKER, hooks: [{ type: "command", command: `node "${hook}"` }] }] },
      })
    );

    const readyRes = spawnSync(process.execPath, [path.resolve("src/cli/cli.ts"), "doctor", workspace, "--json"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home, CANARYWATCH_HOME: state },
    });
    assert.equal(readyRes.status, 0, readyRes.stderr);
    const readyReport = JSON.parse(readyRes.stdout);
    assert.equal(readyReport.passed, true);
    assert.equal(readyReport.checks.find((c: { name: string }) => c.name === "workspace-manifest").health, "ready");
    assert.equal(readyReport.checks.find((c: { name: string }) => c.name === "state-integrity").health, "ready");
    assert.equal(readyReport.checks.find((c: { name: string }) => c.name === "hook-bundle").health, "ready");
    assert.ok(Array.isArray(readyReport.unobserved) && readyReport.unobserved.length > 0);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("doctor detects tampered event log via read-only integrity check", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-doctor-tamper-"));
  const state = path.join(home, ".canarywatch");
  const prevHome = process.env.CANARYWATCH_HOME;
  process.env.CANARYWATCH_HOME = state;
  try {
    appendEvent({
      action: "allow",
      detector: "none",
      reason: "Normal read",
      evidence: { sessionId: "doc-s2", tool: "Read", paths: ["a.txt"], ts: Date.now() },
    });
    // Tamper with log
    const logPath = path.join(state, "events.jsonl");
    const entry = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
    entry.decision.reason = "Tampered reason";
    fs.writeFileSync(logPath, JSON.stringify(entry) + "\n");

    const res = invokeDoctor(home, state);
    const report = JSON.parse(res.stdout);
    assert.equal(res.status, 1);
    assert.equal(report.passed, false);
    assert.equal(report.checks.find((c: { name: string }) => c.name === "state-integrity").status, "fail");
  } finally {
    if (prevHome === undefined) delete process.env.CANARYWATCH_HOME;
    else process.env.CANARYWATCH_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
