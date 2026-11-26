import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveHookScript } from "../src/cli/commands/installHook.ts";
import { seed } from "../src/seeder/seeder.ts";

function invokeHook(hook: string, home: string, input: string) {
  return spawnSync(process.execPath, [hook], {
    input,
    env: { ...process.env, CANARYWATCH_HOME: home },
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
}

test("hook fails closed for malformed input, missing manifests, and targeted Grep reads", () => {
  const hook = resolveHookScript();
  assert.ok(hook);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-hook-home-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cw-hook-workspace-"));
  const previousHome = process.env.CANARYWATCH_HOME;
  process.env.CANARYWATCH_HOME = home;
  try {
    const malformed = invokeHook(hook!, home, "not-json");
    assert.equal(JSON.parse(malformed.stdout).hookSpecificOutput.permissionDecision, "deny");

    const missingManifest = invokeHook(
      hook!,
      home,
      JSON.stringify({ session_id: "test-1", cwd: workspace, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: ".env" } })
    );
    assert.equal(JSON.parse(missingManifest.stdout).hookSpecificOutput.permissionDecision, "deny");

    const seeded = seed(workspace, "light");
    assert.ok(seeded.seeded.length > 0);
    const grep = invokeHook(
      hook!,
      home,
      JSON.stringify({ session_id: "test-2", cwd: workspace, hook_event_name: "PreToolUse", tool_name: "Grep", tool_input: { path: seeded.seeded[0].path, pattern: "DATABASE_URL" } })
    );
    assert.equal(JSON.parse(grep.stdout).hookSpecificOutput.permissionDecision, "deny");
  } finally {
    if (previousHome === undefined) delete process.env.CANARYWATCH_HOME;
    else process.env.CANARYWATCH_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("hook fails closed for an unknown event and corrupt policy", () => {
  const hook = resolveHookScript();
  assert.ok(hook);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cw-hook-invalid-home-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cw-hook-invalid-workspace-"));
  const previousHome = process.env.CANARYWATCH_HOME;
  process.env.CANARYWATCH_HOME = home;
  try {
    seed(workspace, "light");
    const input = { session_id: "invalid-input", cwd: workspace, hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "ordinary.txt" } };
    const unknownEvent = invokeHook(hook!, home, JSON.stringify(input));
    assert.equal(JSON.parse(unknownEvent.stdout).hookSpecificOutput.permissionDecision, "deny");

    fs.writeFileSync(path.join(home, "policy.json"), "{broken");
    const corruptPolicy = invokeHook(hook!, home, JSON.stringify({ ...input, hook_event_name: "PreToolUse", session_id: "corrupt-policy" }));
    assert.equal(JSON.parse(corruptPolicy.stdout).hookSpecificOutput.permissionDecision, "deny");

    fs.writeFileSync(path.join(home, "policy.json"), JSON.stringify({ scopeEnforced: "false", massMod: { threshold: 0 } }));
    const invalidPolicy = invokeHook(hook!, home, JSON.stringify({ ...input, hook_event_name: "PreToolUse", session_id: "invalid-policy" }));
    assert.equal(JSON.parse(invalidPolicy.stdout).hookSpecificOutput.permissionDecision, "deny");
  } finally {
    if (previousHome === undefined) delete process.env.CANARYWATCH_HOME;
    else process.env.CANARYWATCH_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
