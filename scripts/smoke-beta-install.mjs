import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const builtBeta = path.join(repoRoot, "dist", "canarywatch-beta");
assert.ok(fs.existsSync(builtBeta), "Run npm run build:beta before the beta install smoke test");

// Canonicalize tempRoot so macOS /var -> /private/var matches import.meta.url in the CLI.
const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-beta-smoke-")));
const packageRoot = path.join(tempRoot, "extracted-beta");
const userHome = path.join(tempRoot, "user-home");
const stateHome = path.join(tempRoot, "canarywatch-state");
const workspace = path.join(tempRoot, "workspace with spaces");
const cli = path.join(packageRoot, "bin", "canarywatch.mjs");
const settingsPath = path.join(userHome, ".claude", "settings.json");
const sentinel = { id: "user-owned-hook", hooks: [{ type: "command", command: "echo preserve-me" }] };
const env = { ...process.env, HOME: userHome, USERPROFILE: userHome, CANARYWATCH_HOME: stateHome };

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, `Could not run beta CLI: ${result.error}`);
  assert.equal(result.status, 0, `Beta CLI ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

try {
  fs.cpSync(builtBeta, packageRoot, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({ hooks: { PreToolUse: [sentinel] } }, null, 2));
  fs.writeFileSync(path.join(workspace, ".gitignore"), "# user rules\n");
  fs.writeFileSync(path.join(workspace, "keep.txt"), "user data\n");

  run(["init", workspace]);
  const doctor = JSON.parse(run(["doctor", "--json"]));
  assert.equal(doctor.passed, true, "doctor should recognize the freshly installed beta hook");
  const manifestPath = path.join(stateHome, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.ok(manifest.entries.length > 0, "init should seed canaries");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.hooks.PreToolUse.find((entry) => entry.id === sentinel.id), sentinel, "init must preserve existing hooks");
  const managedHook = settings.hooks.PreToolUse.find((entry) => entry.id === "canarywatch-managed-hook-v1");
  assert.ok(managedHook, "init should register the managed hook");
  const registeredCommand = managedHook.hooks.find((entry) => entry.type === "command")?.command;
  assert.equal(registeredCommand, `node "${path.join(packageRoot, "bin", "hook.cjs")}"`);
  assert.ok(fs.existsSync(path.join(packageRoot, "bin", "hook.cjs")), "registered hook must exist in extracted beta");

  const hookResult = spawnSync(process.execPath, [path.join(packageRoot, "bin", "hook.cjs")], {
    input: JSON.stringify({
      session_id: "beta-smoke",
      cwd: workspace,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: manifest.entries[0].path },
    }),
    env,
    encoding: "utf8",
  });
  assert.equal(hookResult.status, 0, hookResult.stderr);
  assert.equal(JSON.parse(hookResult.stdout).hookSpecificOutput.permissionDecision, "deny");

  run(["uninstall-hook"]);
  const uninstalledSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(uninstalledSettings.hooks.PreToolUse, [sentinel], "uninstall must preserve user-owned hooks");

  run(["unseed", workspace]);
  assert.equal(JSON.parse(fs.readFileSync(manifestPath, "utf8")).entries.length, 0);
  assert.ok(!fs.existsSync(manifest.entries[0].path), "unseed should remove unchanged seeded files");
  assert.equal(fs.readFileSync(path.join(workspace, "keep.txt"), "utf8"), "user data\n");
  assert.equal(fs.readFileSync(path.join(workspace, ".gitignore"), "utf8"), "# user rules\n");
  console.log("beta install, hook execution, uninstall, and unseed passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
