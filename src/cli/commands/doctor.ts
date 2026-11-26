import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validatePolicyConfig } from "../../core/config.ts";
import { canonicalize } from "../../core/canonicalize.ts";
import { verifyChainAt } from "../../core/eventlog.ts";
import { verifyEntry } from "../../core/manifest.ts";
import type { Manifest } from "../../core/types.ts";
import { isCanarywatchHook, resolveHookScript } from "./installHook.ts";
import packageJson from "../../../package.json" with { type: "json" };

export type CheckHealth = "ready" | "missing" | "not_seeded" | "error";

export interface DoctorCheck {
  name: string;
  label: string;
  status: "pass" | "fail";
  health: CheckHealth;
  detail: string;
}

export interface DoctorReport {
  schemaVersion: "1.0.0";
  canarywatchVersion: string;
  checks: DoctorCheck[];
  passed: boolean;
  unobserved: string[];
  coverageNote: string;
  nextSteps: string[];
}

const COVERAGE_NOTE =
  "This checks Claude Code tool calls and the optional MCP proxy. It does not sandbox the operating system or inspect unsupported tools.";

const UNOBSERVED_SURFACES = [
  "OS/kernel syscalls outside Claude Code",
  "Raw socket or in-memory network exfiltration",
  "Other agent harnesses or tools bypassing PreToolUse",
  "Unproxied MCP servers",
];

function nodeVersionSupported(): boolean {
  const match = /^v?(\d+)\.(\d+)/.exec(process.version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 22 || (major === 22 && minor >= 18);
}

function probeHookVersion(hookScript: string): { ok: boolean; version?: string; error?: string } {
  const res = spawnSync(process.execPath, [hookScript, "--version"], {
    encoding: "utf8",
    timeout: 3000,
  });
  if (res.error) return { ok: false, error: res.error.message };
  if (res.status !== 0) return { ok: false, error: res.stderr?.trim() || `exit ${res.status}` };
  return { ok: true, version: res.stdout.trim() };
}

function checkWorkspaceManifestReadOnly(stateDir: string, workspace: string): DoctorCheck {
  const manifestFile = path.join(stateDir, "manifest.json");
  const keyFile = path.join(stateDir, "key");
  if (!fs.existsSync(manifestFile)) {
    return {
      name: "workspace-manifest",
      label: "Workspace manifest",
      status: "pass",
      health: "not_seeded",
      detail: "No canaries in this workspace",
    };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(manifestFile, "utf8");
  } catch {
    return {
      name: "workspace-manifest",
      label: "Workspace manifest",
      status: "fail",
      health: "error",
      detail: "Manifest file is unreadable",
    };
  }
  if (raw.trim().length === 0) {
    return {
      name: "workspace-manifest",
      label: "Workspace manifest",
      status: "pass",
      health: "not_seeded",
      detail: "No canaries in this workspace",
    };
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(raw) as Manifest;
  } catch {
    return {
      name: "workspace-manifest",
      label: "Workspace manifest",
      status: "fail",
      health: "error",
      detail: "Manifest JSON is corrupt",
    };
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) {
    return {
      name: "workspace-manifest",
      label: "Workspace manifest",
      status: "fail",
      health: "error",
      detail: "Manifest has an invalid format",
    };
  }

  if (manifest.entries.length > 0) {
    if (!fs.existsSync(keyFile)) {
      return {
        name: "workspace-manifest",
        label: "Workspace manifest",
        status: "fail",
        health: "error",
        detail: "Manifest signing key is missing",
      };
    }
    let key: Buffer;
    try {
      key = fs.readFileSync(keyFile);
    } catch {
      return {
        name: "workspace-manifest",
        label: "Workspace manifest",
        status: "fail",
        health: "error",
        detail: "Manifest signing key is unreadable",
      };
    }
    if (key.length !== 32) {
      return {
        name: "workspace-manifest",
        label: "Workspace manifest",
        status: "fail",
        health: "error",
        detail: "Manifest signing key has an invalid length",
      };
    }
    for (const entry of manifest.entries) {
      if (!verifyEntry(key, entry)) {
        return {
          name: "workspace-manifest",
          label: "Workspace manifest",
          status: "fail",
          health: "error",
          detail: "Manifest entry failed HMAC verification",
        };
      }
    }
  }

  const wsCanonical = canonicalize(workspace);
  const wsEntries = manifest.entries.filter((e) => e.workspace === wsCanonical);
  if (wsEntries.length === 0) {
    return {
      name: "workspace-manifest",
      label: "Workspace manifest",
      status: "pass",
      health: "not_seeded",
      detail: "No canaries in this workspace",
    };
  }
  return {
    name: "workspace-manifest",
    label: "Workspace manifest",
    status: "pass",
    health: "ready",
    detail: `${wsEntries.length} verified canary path(s) in this workspace`,
  };
}

function runChecks(workspace: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const stateDir = process.env.CANARYWATCH_HOME || path.join(os.homedir(), ".canarywatch");
  const hookScript = resolveHookScript();
  const configPath = path.join(os.homedir(), ".claude", "settings.json");

  // 1. Hook registration in Claude settings
  try {
    if (!hookScript || !fs.existsSync(hookScript)) {
      checks.push({
        name: "claude-hook",
        label: "Hook registration",
        status: "fail",
        health: "missing",
        detail: "hook script unavailable; run npm run build:plugin",
      });
    } else if (!fs.existsSync(configPath)) {
      checks.push({
        name: "claude-hook",
        label: "Hook registration",
        status: "fail",
        health: "missing",
        detail: "Claude settings file missing; run canarywatch install-hook",
      });
    } else {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const preHooks = config?.hooks?.PreToolUse;
      const managed = Array.isArray(preHooks) ? preHooks.filter(isCanarywatchHook) : [];
      const current = managed.some(
        (entry: any) =>
          Array.isArray(entry.hooks) &&
          entry.hooks.some(
            (hook: any) =>
              hook?.type === "command" && typeof hook.command === "string" && hook.command.includes(hookScript)
          )
      );
      checks.push({
        name: "claude-hook",
        label: "Hook registration",
        status: current ? "pass" : "fail",
        health: current ? "ready" : "missing",
        detail: current ? "Claude settings entry found" : "missing or stale; run canarywatch install-hook",
      });
    }
  } catch {
    checks.push({
      name: "claude-hook",
      label: "Hook registration",
      status: "fail",
      health: "error",
      detail: "settings unreadable or corrupt; inspect ~/.claude/settings.json",
    });
  }

  // 2. Hook bundle availability and version match
  if (!hookScript || !fs.existsSync(hookScript)) {
    checks.push({
      name: "hook-bundle",
      label: "Hook bundle",
      status: "fail",
      health: "missing",
      detail: "hook bundle not found; run npm run build:plugin",
    });
  } else {
    const probed = probeHookVersion(hookScript);
    if (!probed.ok) {
      checks.push({
        name: "hook-bundle",
        label: "Hook bundle",
        status: "fail",
        health: "error",
        detail: `failed to verify hook bundle version (${probed.error})`,
      });
    } else if (probed.version !== packageJson.version) {
      checks.push({
        name: "hook-bundle",
        label: "Hook bundle",
        status: "fail",
        health: "error",
        detail: `version mismatch (hook=${probed.version}, cli=${packageJson.version}); run npm run build:plugin`,
      });
    } else {
      checks.push({
        name: "hook-bundle",
        label: "Hook bundle",
        status: "pass",
        health: "ready",
        detail: `Version matches this CLI (${packageJson.version})`,
      });
    }
  }

  // 3. State directory
  let stateDirReady = false;
  try {
    const stat = fs.statSync(stateDir);
    if (!stat.isDirectory()) throw new Error("not a directory");
    fs.accessSync(stateDir, fs.constants.R_OK | fs.constants.W_OK);
    stateDirReady = true;
    checks.push({
      name: "state-directory",
      label: "State directory",
      status: "pass",
      health: "ready",
      detail: "exists and is readable/writable",
    });
  } catch {
    checks.push({
      name: "state-directory",
      label: "State directory",
      status: "fail",
      health: "missing",
      detail: "missing or inaccessible; run canarywatch init",
    });
  }

  // 4. Local policy
  const policyPath = path.join(stateDir, "policy.json");
  try {
    if (fs.existsSync(policyPath)) {
      const rawPolicy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
      const problem = validatePolicyConfig(rawPolicy);
      if (problem) throw new Error(problem);
    }
    checks.push({
      name: "policy-config",
      label: "Local policy",
      status: "pass",
      health: "ready",
      detail: fs.existsSync(policyPath)
        ? "7 detectors configured (valid policy.json)"
        : "7 detectors configured (using built-in defaults)",
    });
  } catch {
    checks.push({
      name: "policy-config",
      label: "Local policy",
      status: "fail",
      health: "error",
      detail: "invalid policy JSON or field values; repair policy.json before using Canarywatch",
    });
  }

  // 5. Workspace manifest (read-only)
  if (!stateDirReady) {
    checks.push({
      name: "workspace-manifest",
      label: "Workspace manifest",
      status: "pass",
      health: "not_seeded",
      detail: "No canaries in this workspace",
    });
  } else {
    checks.push(checkWorkspaceManifestReadOnly(stateDir, workspace));
  }

  // 6. State integrity (read-only event log + head anchor verification)
  if (!stateDirReady) {
    checks.push({
      name: "state-integrity",
      label: "State integrity",
      status: "pass",
      health: "missing",
      detail: "No event log yet (state directory missing)",
    });
  } else {
    const chain = verifyChainAt(stateDir);
    if (!chain.valid) {
      checks.push({
        name: "state-integrity",
        label: "State integrity",
        status: "fail",
        health: "error",
        detail: chain.reason ?? "Event log integrity check failed",
      });
    } else if (chain.empty) {
      checks.push({
        name: "state-integrity",
        label: "State integrity",
        status: "pass",
        health: "ready",
        detail: "No event log yet (clean state)",
      });
    } else {
      checks.push({
        name: "state-integrity",
        label: "State integrity",
        status: "pass",
        health: "ready",
        detail: `Event log verified (${chain.eventCount} event(s))`,
      });
    }
  }

  // 7. Node runtime
  checks.push({
    name: "node-version",
    label: "Node runtime",
    status: nodeVersionSupported() ? "pass" : "fail",
    health: nodeVersionSupported() ? "ready" : "error",
    detail: nodeVersionSupported() ? `Node ${process.version}` : `Node ${process.version}; install Node >=22.18`,
  });

  return checks;
}

function computeNextSteps(checks: DoctorCheck[]): string[] {
  const byName = new Map(checks.map((c) => [c.name, c]));
  const steps: string[] = [];
  if (byName.get("state-directory")?.health === "missing") {
    steps.push("canarywatch init");
    return steps;
  }
  if (byName.get("hook-bundle")?.status === "fail") {
    steps.push("npm run build:plugin");
  }
  if (byName.get("claude-hook")?.status === "fail") {
    steps.push("canarywatch install-hook");
  }
  if (byName.get("policy-config")?.status === "fail") {
    steps.push("repair policy.json in CANARYWATCH_HOME");
  }
  if (byName.get("state-integrity")?.status === "fail") {
    steps.push("inspect broken event log via `canarywatch events --verify`");
  }
  if (byName.get("workspace-manifest")?.health === "not_seeded") {
    steps.push("canarywatch seed .");
  }
  return steps;
}

function formatHealthTag(check: DoctorCheck): string {
  switch (check.health) {
    case "ready":
      return "READY";
    case "not_seeded":
      return "NOT SEEDED";
    case "missing":
      return "MISSING";
    case "error":
      return "FAIL";
  }
}

export function runDoctor(args: string[]): void {
  const unknown = args.filter((arg) => arg.startsWith("-") && arg !== "--json");
  if (unknown.length > 0) {
    console.error(`canarywatch doctor: unknown option ${unknown[0]}`);
    process.exitCode = 2;
    return;
  }
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const workspace = positional[0] ?? process.cwd();

  const checks = runChecks(workspace);
  const passed = checks.every((check) => check.status === "pass");
  const nextSteps = computeNextSteps(checks);

  const report: DoctorReport = {
    schemaVersion: "1.0.0",
    canarywatchVersion: packageJson.version,
    checks,
    passed,
    unobserved: UNOBSERVED_SURFACES,
    coverageNote: COVERAGE_NOTE,
    nextSteps,
  };

  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`CANARYWATCH ${packageJson.version}   SETUP CHECK\n`);
    for (const check of checks) {
      const tag = formatHealthTag(check).padEnd(11);
      console.log(`${check.label.padEnd(23)} ${tag} ${check.detail}`);
    }
    console.log("");
    console.log(`${"Unobserved surfaces".padEnd(23)} ${"UNOBSERVED".padEnd(11)} OS syscalls, raw sockets, other harnesses, unproxied MCP`);
    console.log("");
    console.log("Coverage note");
    console.log("This checks Claude Code tool calls and the optional MCP proxy.");
    console.log("It does not sandbox the operating system or inspect unsupported tools.");
    if (nextSteps.length > 0) {
      console.log("");
      console.log(`Next step: ${nextSteps[0]}`);
      for (const extra of nextSteps.slice(1)) {
        console.log(`           ${extra}`);
      }
    }
  }
  if (!passed) process.exitCode = 1;
}
