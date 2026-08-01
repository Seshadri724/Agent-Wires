import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runInstallHook, runUninstallHook } from "../src/cli/commands/installHook.ts";

test("install-hook and uninstall-hook integration", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-install-"));
  const origHome = process.env.HOME || process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;

  const claudeConfigPath = path.join(tmpHome, ".claude.json");
  // Seed existing unrelated hook in .claude.json
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

  assert.ok(fs.existsSync(claudeConfigPath));
  const installedConfig = JSON.parse(fs.readFileSync(claudeConfigPath, "utf8"));
  assert.equal(installedConfig.hooks.PreToolUse.length, 2);

  const canarywatchEntry = installedConfig.hooks.PreToolUse.find((h: any) =>
    JSON.stringify(h).includes("hook.cjs") || JSON.stringify(h).includes("hook.ts")
  );
  assert.ok(canarywatchEntry, "canarywatch hook entry should be present");
  assert.equal(canarywatchEntry.matcher, "Read|Write|Edit|Bash|Glob|Grep|NotebookEdit");
  assert.equal(canarywatchEntry.hooks[0].type, "command");

  // Run uninstall-hook
  runUninstallHook();

  const uninstalledConfig = JSON.parse(fs.readFileSync(claudeConfigPath, "utf8"));
  assert.equal(uninstalledConfig.hooks.PreToolUse.length, 1);
  assert.equal(uninstalledConfig.hooks.PreToolUse[0].hooks[0].command, "node /path/to/other-tool-hook.js");

  // Restore env
  if (origHome) {
    process.env.HOME = origHome;
    process.env.USERPROFILE = origHome;
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
});
