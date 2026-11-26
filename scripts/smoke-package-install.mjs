import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-package-smoke-"));
const packDir = path.join(tempRoot, "pack");
const consumer = path.join(tempRoot, "consumer");
const userHome = path.join(tempRoot, "user-home");
const stateHome = path.join(tempRoot, "canarywatch-state");
const workspace = path.join(tempRoot, "workspace");
const env = { ...process.env, HOME: userHome, USERPROFILE: userHome, CANARYWATCH_HOME: stateHome };

function npm(args, cwd = repoRoot) {
  const npmCli = process.env.npm_execpath;
  const result = npmCli
    ? spawnSync(process.execPath, [npmCli, ...args], { cwd, env, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, { cwd, env, encoding: "utf8", maxBuffer: 2 * 1024 * 1024, shell: process.platform === "win32" });
  assert.equal(result.error, undefined, `Could not run npm: ${result.error}`);
  assert.equal(result.status, 0, `npm ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function runCli(cli, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: repoRoot, env, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.error, undefined, `Could not run packaged CLI: ${result.error}`);
  assert.equal(result.status, 0, `canarywatch ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function parsePackJson(stdout) {
  // npm 10 still runs `prepare` during `npm pack --ignore-scripts`, interleaving
  // build output before the JSON array on stdout; npm 11 omits it.
  const match = /(?:^|\r?\n)\[\s*\r?\n/.exec(stdout);
  const jsonStart = match ? match.index + (match[0].startsWith("\n") || match[0].startsWith("\r") ? match[0].indexOf("[") : 0) : stdout.indexOf("[");
  assert.notEqual(jsonStart, -1, `Expected JSON array from npm pack --json, got:\n${stdout}`);
  return JSON.parse(stdout.slice(jsonStart));
}

try {
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(consumer, { recursive: true });
  const packed = parsePackJson(npm(["pack", "--json", "--ignore-scripts", "--pack-destination", packDir]));
  assert.equal(packed.length, 1);
  assert.ok(packed[0].files.some((file) => file.path === "schemas/evaluation-v1.schema.json"), "evaluation schema must ship in npm package");
  const tarball = path.join(packDir, packed[0].filename);
  npm(["install", "--prefix", consumer, "--ignore-scripts", "--offline", "--no-audit", "--no-fund", tarball]);

  const cli = path.join(consumer, "node_modules", "canarywatch", "plugin", "claude-code", "bin", "canarywatch.mjs");
  const hook = path.join(consumer, "node_modules", "canarywatch", "plugin", "claude-code", "bin", "hook.cjs");
  assert.ok(fs.existsSync(cli), "installed package must include the CLI");
  assert.ok(fs.existsSync(hook), "installed package must include its hook");
  fs.mkdirSync(path.join(userHome, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(userHome, ".claude", "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ id: "user-hook" }] } }));
  fs.mkdirSync(workspace, { recursive: true });
  runCli(cli, ["init", workspace]);
  assert.equal(JSON.parse(runCli(cli, ["doctor", "--json"])).passed, true);

  const manifest = JSON.parse(fs.readFileSync(path.join(stateHome, "manifest.json"), "utf8"));
  const hookResult = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ session_id: "npm-package-smoke", cwd: workspace, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: manifest.entries[0].path } }),
    env,
    encoding: "utf8",
  });
  assert.equal(hookResult.status, 0, hookResult.stderr);
  assert.equal(JSON.parse(hookResult.stdout).hookSpecificOutput.permissionDecision, "deny");
  runCli(cli, ["uninstall-hook"]);
  runCli(cli, ["unseed", workspace]);
  const settings = JSON.parse(fs.readFileSync(path.join(userHome, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(settings.hooks.PreToolUse, [{ id: "user-hook" }]);
  console.log("npm package install, doctor, hook execution, uninstall, and unseed passed");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
