// `canarywatch test` — the trust ritual (docs/ROADMAP.md Phase 1 item 6).
// Spawns the *actual* hook binary as a subprocess against an isolated,
// throwaway CANARYWATCH_HOME + workspace, and asserts it makes the right
// call. This exercises the real artifact users depend on, not a mock.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { seed } from "../../seeder/seeder.ts";
import { DEFAULT_POLICY } from "../../core/types.ts";
import { resolveHookScript } from "./installHook.ts";

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

function callHook(
  home: string,
  hookPath: string,
  input: Record<string, unknown>,
): { permissionDecision: string; reason: string } {
  const result = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(input),
    env: { ...process.env, CANARYWATCH_HOME: home },
    encoding: "utf8",
  });
  if (result.status !== 0 && !result.stdout) {
    throw new Error(`hook process failed: ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout);
  return {
    permissionDecision: parsed.hookSpecificOutput.permissionDecision,
    reason: parsed.hookSpecificOutput.permissionDecisionReason,
  };
}

export async function runTest(): Promise<void> {
  const hookPath = resolveHookScript();
  if (!hookPath) {
    console.error("canarywatch test: could not locate the hook script.");
    console.error("  Expected bin/hook.cjs next to the CLI, or a source checkout.");
    process.exitCode = 1;
    return;
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-selftest-"));
  const home = path.join(tmpRoot, "home");
  const workspace = path.join(tmpRoot, "workspace");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });

  const checks: Check[] = [];

  try {
    process.env.CANARYWATCH_HOME = home;

    // D4 (mass modification) is a time-windowed detector (default: >50
    // writes in 10s). This self-test drives the hook as a real subprocess
    // per call — Node cold-start overhead alone can exceed 10s across 50+
    // calls, which would make the check flaky for reasons that have
    // nothing to do with whether the detector logic is correct. Use a
    // relaxed, self-test-only threshold/window instead of the production
    // default so the check is fast and deterministic.
    const { savePolicy } = await import("../../core/config.ts");
    savePolicy({ ...DEFAULT_POLICY, massMod: { ...DEFAULT_POLICY.massMod, threshold: 5, windowMs: 120_000 } });

    const seedResult = seed(workspace, "standard");
    if (seedResult.seeded.length === 0) {
      throw new Error("seeding produced no canaries — cannot self-test");
    }
    const canaryPath = seedResult.seeded[0].path;

    // 1. Targeted read of a canary must be denied.
    const canaryRead = callHook(home, hookPath, {
      session_id: "selftest-1",
      cwd: workspace,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: canaryPath },
    });
    checks.push({
      name: "D1 canary read is denied",
      pass: canaryRead.permissionDecision === "deny",
      detail: `got ${canaryRead.permissionDecision}: ${canaryRead.reason}`,
    });

    // 2. A broad Glob that merely lists (not reads) the canary must NOT be
    //    denied — this is the load-bearing list-vs-read distinction from
    //    docs/THREAT-MODEL.md §2 that keeps baseline false positives at zero.
    const sweep = callHook(home, hookPath, {
      session_id: "selftest-2",
      cwd: workspace,
      hook_event_name: "PreToolUse",
      tool_name: "Glob",
      tool_input: { pattern: "**/*", path: workspace },
    });
    checks.push({
      name: "Glob sweep (list access) is allowed",
      pass: sweep.permissionDecision === "allow",
      detail: `got ${sweep.permissionDecision}: ${sweep.reason}`,
    });

    // 3. A normal read of an unrelated file must be allowed (baseline).
    const normalFile = path.join(workspace, "index.js");
    fs.writeFileSync(normalFile, "console.log('hi');\n");
    const normalRead = callHook(home, hookPath, {
      session_id: "selftest-3",
      cwd: workspace,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: normalFile },
    });
    checks.push({
      name: "Normal file read is allowed",
      pass: normalRead.permissionDecision === "allow",
      detail: `got ${normalRead.permissionDecision}: ${normalRead.reason}`,
    });

    // 4. Sensitive-path read (real .env, not a decoy) must be denied.
    const envPath = path.join(workspace, ".env");
    fs.writeFileSync(envPath, "SECRET=1\n");
    const envRead = callHook(home, hookPath, {
      session_id: "selftest-4",
      cwd: workspace,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: envPath },
    });
    checks.push({
      name: "D2 sensitive-path (.env) read is denied",
      pass: envRead.permissionDecision === "deny",
      detail: `got ${envRead.permissionDecision}: ${envRead.reason}`,
    });

    // 5. Once a session is paused, subsequent calls in that session are
    //    denied too (session lock), until `canarywatch resume`.
    const followUp = callHook(home, hookPath, {
      session_id: "selftest-1",
      cwd: workspace,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: normalFile },
    });
    checks.push({
      name: "Locked session denies follow-up calls",
      pass: followUp.permissionDecision === "deny",
      detail: `got ${followUp.permissionDecision}: ${followUp.reason}`,
    });

    const tokenWrite = callHook(home, hookPath, {
      session_id: "selftest-token",
      cwd: workspace,
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: {
        file_path: path.join(workspace, "notes.md"),
        content: `copied ${seedResult.seeded[0].tokenId}`,
      },
    });
    checks.push({
      name: "D1 canary token reuse in Write is denied",
      pass: tokenWrite.permissionDecision === "deny",
      detail: `got ${tokenWrite.permissionDecision}: ${tokenWrite.reason}`,
    });

    // 6. Mass modification: many writes fast in one session trips D4
    //    (relaxed threshold=5 for this self-test, see policy override above).
    let lastMassMod = { permissionDecision: "allow", reason: "" };
    for (let i = 0; i < 10; i++) {
      lastMassMod = callHook(home, hookPath, {
        session_id: "selftest-6",
        cwd: workspace,
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: path.join(workspace, `gen-${i}.txt`) },
      });
      if (lastMassMod.permissionDecision === "deny") break;
    }
    checks.push({
      name: "D4 mass modification is denied",
      pass: lastMassMod.permissionDecision === "deny",
      detail: `got ${lastMassMod.permissionDecision}: ${lastMassMod.reason}`,
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log("canarywatch self-test\n");
  let allPass = true;
  for (const c of checks) {
    console.log(`  [${c.pass ? "PASS" : "FAIL"}] ${c.name}`);
    if (!c.pass) console.log(`         ${c.detail}`);
    allPass = allPass && c.pass;
  }
  console.log("");
  console.log(allPass ? "All checks passed." : "Some checks FAILED.");
  process.exitCode = allPass ? 0 : 1;
}
