import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CANARYWATCH_HOOK_MARKER, runInstallHook, runUninstallHook, resolveHookScript } from "../src/cli/commands/installHook.ts";

// A registered hook path that doesn't exist means canarywatch looks installed
// while silently protecting nothing — the worst failure mode this tool has.
test("the registered hook command points at a file that actually exists", () => {
  const resolved = resolveHookScript();
  assert.ok(resolved, "hook script should resolve");
  assert.ok(fs.existsSync(resolved!), `resolved hook script does not exist: ${resolved}`);
});

test("install-hook and uninstall-hook integration", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-install-"));
  const origHome = process.env.HOME || process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;

  const claudeConfigPath = path.join(tmpHome, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(claudeConfigPath), { recursive: true });
  // Seed existing unrelated hook in settings.json
  const existingConfig = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "node /path/to/other-tool-hook.js" }],
        },
      ],
    },
  };
  fs.writeFileSync(claudeConfigPath, JSON.stringify(existingConfig, null, 2));

  // Run install-hook
  runInstallHook([]);
  runInstallHook([]);

  assert.ok(fs.existsSync(claudeConfigPath));
  const installedConfig = JSON.parse(fs.readFileSync(claudeConfigPath, "utf8"));
  assert.equal(installedConfig.hooks.PreToolUse.length, 2);

  const canarywatchEntry = installedConfig.hooks.PreToolUse.find((h: any) =>
    JSON.stringify(h).includes("hook.cjs") || JSON.stringify(h).includes("hook.ts")
  );
  assert.ok(canarywatchEntry, "canarywatch hook entry should be present");
  assert.equal(canarywatchEntry.matcher, "Read|Write|Edit|Bash|Glob|Grep|NotebookEdit|mcp__.*");
  assert.equal(canarywatchEntry.hooks[0].type, "command");

  // Run uninstall-hook
  runUninstallHook();

  const uninstalledConfig = JSON.parse(fs.readFileSync(claudeConfigPath, "utf8"));
  assert.equal(uninstalledConfig.hooks.PreToolUse.length, 1);
  assert.equal(uninstalledConfig.hooks.PreToolUse[0].hooks[0].command, "node /path/to/other-tool-hook.js");

  // A legacy entry written to ~/.claude.json by earlier builds is cleaned too.
  const legacy = path.join(tmpHome, ".claude.json");
  runInstallHook([]);
  const entry = JSON.parse(fs.readFileSync(claudeConfigPath, "utf8")).hooks.PreToolUse.at(-1);
  fs.writeFileSync(legacy, JSON.stringify({ theme: "dark", hooks: { PreToolUse: [entry] } }));
  runUninstallHook();
  assert.deepEqual(JSON.parse(fs.readFileSync(legacy, "utf8")), { theme: "dark" });

  // Restore env
  if (origHome) {
    process.env.HOME = origHome;
    process.env.USERPROFILE = origHome;
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test("install-hook preserves malformed settings and reports failure", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-invalid-config-"));
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  const previousExitCode = process.exitCode;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  const configPath = path.join(tmpHome, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const malformed = '{"custom": "keep me"';
  fs.writeFileSync(configPath, malformed);
  process.exitCode = 0;

  try {
    runInstallHook([]);
    assert.equal(fs.readFileSync(configPath, "utf8"), malformed);
    assert.equal(process.exitCode, 1);
  } finally {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;
    process.exitCode = previousExitCode;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("install-hook upgrades stale managed entries and preserves unrelated hooks", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-upgrade-"));
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  const previousExitCode = process.exitCode;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  const configPath = path.join(tmpHome, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    theme: "dark",
    hooks: { PreToolUse: [
      { matcher: "Bash", hooks: [{ type: "command", command: "node unrelated.js" }] },
      { id: "canarywatch-managed-hook-v1", hooks: [{ type: "command", command: "node old-hook.cjs" }] },
      { owner: "canarywatch-managed-hook-v1", hooks: [{ type: "command", command: "node duplicate-old-hook.cjs" }] },
    ] },
  }));
  process.exitCode = 0;
  try {
    runInstallHook([]);
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(config.theme, "dark");
    assert.equal(config.hooks.PreToolUse.length, 2);
    assert.equal(config.hooks.PreToolUse[0].hooks[0].command, "node unrelated.js");
    const managed = config.hooks.PreToolUse[1];
    assert.equal(managed.id, "canarywatch-managed-hook-v1");
    assert.ok(managed.hooks[0].command.includes("hook.cjs") || managed.hooks[0].command.includes("hook.ts"));
    assert.equal(process.exitCode, 0);
  } finally {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;
    process.exitCode = previousExitCode;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("install-hook restores settings from a backup left by an interrupted Windows replacement", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-recovery-"));
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  const previousExitCode = process.exitCode;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  const configPath = path.join(tmpHome, ".claude", "settings.json");
  const backup = `${configPath}.${CANARYWATCH_HOOK_MARKER}.bak`;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, '{"partial":');
  fs.writeFileSync(backup, JSON.stringify({ theme: "dark", hooks: { PreToolUse: [{ id: "user-hook" }] } }));
  process.exitCode = 0;
  try {
    runInstallHook([]);
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(config.theme, "dark");
    assert.ok(config.hooks.PreToolUse.some((hook: any) => hook.id === "user-hook"));
    assert.ok(config.hooks.PreToolUse.some((hook: any) => hook.id === CANARYWATCH_HOOK_MARKER));
    assert.equal(fs.existsSync(backup), false);
    assert.equal(process.exitCode, 0);
  } finally {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;
    process.exitCode = previousExitCode;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
