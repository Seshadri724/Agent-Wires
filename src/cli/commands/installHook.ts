import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const CANARYWATCH_HOOK_MARKER = "canarywatch-managed-hook-v1";

function getClaudeConfigPath(): string {
  return path.join(os.homedir(), ".claude.json");
}

function getHookCommand(scriptPath: string): string {
  return `node "${scriptPath}"`;
}

export function isCanarywatchHook(hookObj: any): boolean {
  if (!hookObj) return false;
  if (hookObj.id === CANARYWATCH_HOOK_MARKER || hookObj.owner === CANARYWATCH_HOOK_MARKER) return true;
  const subHooks = Array.isArray(hookObj.hooks) ? hookObj.hooks : [];
  return subHooks.some((sh: any) => sh?.id === CANARYWATCH_HOOK_MARKER || sh?.owner === CANARYWATCH_HOOK_MARKER);
}

/**
 * Locate the hook script to register. The CLI runs from two very different
 * layouts: a source checkout (src/cli/commands/) and the distributed bundle
 * (bin/canarywatch.mjs sitting next to bin/hook.cjs). Resolving only against
 * the repo layout meant the bundle registered a path that did not exist on a
 * tester's machine — the hook then silently never ran, so canarywatch looked
 * installed while protecting nothing.
 */
export function resolveHookScript(): string | undefined {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  return [
    path.join(__dirname, "hook.cjs"), // distributed bundle: sibling of the CLI
    path.join(repoRoot, "plugin", "claude-code", "bin", "hook.cjs"), // checkout, plugin built
    path.join(repoRoot, "src", "hook", "hook.ts"), // checkout, running from source
  ].find((p) => fs.existsSync(p));
}

export function runInstallHook(args: string[]): void {
  const dryRun = args.includes("--dry-run");
  const actualHook = resolveHookScript();

  if (!actualHook) {
    console.error("canarywatch install-hook: could not locate the hook script.");
    console.error("  Expected bin/hook.cjs next to the CLI, or a source checkout.");
    console.error("  Nothing was registered — canarywatch is NOT protecting this machine.");
    process.exitCode = 1;
    return;
  }

  const hookCommandStr = getHookCommand(actualHook);

  console.log(`canarywatch install-hook`);
  console.log(`  Hook script: ${actualHook}`);

  const claudeConfigPath = getClaudeConfigPath();
  let config: Record<string, any> = {};

  if (fs.existsSync(claudeConfigPath)) {
    try {
      config = JSON.parse(fs.readFileSync(claudeConfigPath, "utf8"));
    } catch {
      config = {};
    }
  }

  const hooks = (config.hooks ?? {}) as Record<string, any[]>;
  const preHooks = (hooks.PreToolUse ?? []) as any[];

  const newHookEntry = {
    id: CANARYWATCH_HOOK_MARKER,
    owner: CANARYWATCH_HOOK_MARKER,
    matcher: "Read|Write|Edit|Bash|Glob|Grep|NotebookEdit",
    hooks: [
      {
        id: CANARYWATCH_HOOK_MARKER,
        type: "command",
        command: hookCommandStr,
      },
    ],
  };

  const hasHook = preHooks.some(isCanarywatchHook);

  if (hasHook) {
    console.log(`  Status: canarywatch hook is already registered in ${claudeConfigPath}`);
    return;
  }

  preHooks.push(newHookEntry);
  hooks.PreToolUse = preHooks;
  config.hooks = hooks;

  if (dryRun) {
    console.log(`  [Dry Run] Would write updated config to ${claudeConfigPath}:`);
    console.log(JSON.stringify(config, null, 2));
  } else {
    fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
    console.log(`  Successfully registered canarywatch hook in ${claudeConfigPath}`);
  }
}

export function runUninstallHook(): void {
  const claudeConfigPath = getClaudeConfigPath();
  if (!fs.existsSync(claudeConfigPath)) {
    console.log("No Claude configuration file found.");
    return;
  }

  try {
    const config = JSON.parse(fs.readFileSync(claudeConfigPath, "utf8"));
    if (config.hooks) {
      let removedCount = 0;
      for (const eventName of Object.keys(config.hooks)) {
        if (Array.isArray(config.hooks[eventName])) {
          const before = config.hooks[eventName].length;
          config.hooks[eventName] = config.hooks[eventName].filter((h: any) => !isCanarywatchHook(h));
          removedCount += before - config.hooks[eventName].length;
        }
      }

      if (removedCount > 0) {
        fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
        console.log(`Successfully uninstalled ${removedCount} canarywatch hook entry(ies) from ${claudeConfigPath}`);
      } else {
        console.log("No canarywatch hooks were registered.");
      }
    } else {
      console.log("No hooks registered in Claude configuration.");
    }
  } catch (err) {
    console.error(`Failed to uninstall hook: ${err}`);
  }
}
