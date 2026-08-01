#!/usr/bin/env node
// The Claude Code PreToolUse/PostToolUse hook entrypoint.
// docs/ARCHITECTURE.md §3.2 "Hook Sensor", §3.4 "Response Orchestrator".
//
// Reads the hook JSON Claude Code sends on stdin, evaluates it against
// policy, and writes a permission-decision JSON to stdout. See:
// docs/RESOURCES.md "Claude Code hooks reference" for the wire schema.
//
// Fail-mode policy (docs/ARCHITECTURE.md §6): if we cannot load/verify the
// manifest, we cannot rule out a canary touch, so we fail CLOSED (deny).
// Any other unexpected error fails OPEN (allow) with a loud stderr warning,
// so a bug in canarywatch never becomes "the agent can't do anything."

import { loadPolicy } from "../core/config.ts";
import { buildManifestPathSet, loadManifest, loadOrCreateKey } from "../core/manifest.ts";
import { evaluate } from "../core/policy.ts";
import { acquireLock, loadSession, saveSession } from "../core/session.ts";
import { getWorkspaceScope } from "../core/scope.ts";
import { appendEvent } from "../core/eventlog.ts";
import { sendDesktopNotification } from "../core/notifier.ts";
import { extractPathClaims } from "./pathClaims.ts";
import type { Decision, ToolCallEvent } from "../core/types.ts";

interface ClaudeHookInput {
  session_id: string;
  cwd: string;
  hook_event_name: "PreToolUse" | "PostToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function notify(decision: Decision): void {
  // Always log to stderr — visible in Claude Code's hook debug output and
  // any terminal running the harness, and unlike the desktop toast below
  // it can't silently fail to appear.
  process.stderr.write(
    `[canarywatch] ${decision.action.toUpperCase()} (${decision.detector}) session=${decision.evidence.sessionId} — ${decision.reason}\n`
  );
  // Best-effort OS toast (docs/core/notifier.ts) — fire-and-forget, never
  // blocks or throws into the caller.
  sendDesktopNotification(
    `canarywatch: ${decision.action}`,
    `${decision.detector !== "none" ? decision.detector + " — " : ""}${decision.reason}`
  );
}

function emit(permissionDecision: "allow" | "deny" | "ask", reason: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision,
        permissionDecisionReason: reason,
      },
    })
  );
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let input: ClaudeHookInput;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`[canarywatch] failed to parse hook input, allowing (fail-open): ${err}\n`);
    emit("allow", "canarywatch: could not parse hook input, allowing by default.");
    return;
  }

  let manifestPaths: Set<string>;
  try {
    const key = loadOrCreateKey();
    const manifest = loadManifest();
    manifestPaths = buildManifestPathSet(manifest, key);
  } catch (err) {
    // Cannot verify canaries -> fail CLOSED. This is the one case where
    // "allowing by default" is worse than a false alarm.
    process.stderr.write(`[canarywatch] manifest unavailable, failing CLOSED: ${err}\n`);
    emit("deny", "canarywatch: could not load the canary manifest, denying by default for safety.");
    return;
  }

  try {
    const policy = loadPolicy();
    const paths = extractPathClaims(input.tool_name, input.tool_input);

    const event: ToolCallEvent = {
      kind: "tool_call",
      sessionId: input.session_id,
      tool: input.tool_name,
      paths,
      phase: input.hook_event_name === "PreToolUse" ? "pre" : "post",
      ts: Date.now(),
    };

    const release = acquireLock(input.session_id);
    let decision: Decision;
    try {
      const scopeRoots = getWorkspaceScope(input.cwd);
      const state = loadSession(input.session_id, scopeRoots);

      decision = evaluate(event, policy, manifestPaths, state);

      if (decision.action === "pause" || decision.action === "lockdown") {
        state.locked = true;
      }
      saveSession(state);
    } finally {
      release();
    }
    appendEvent(decision);

    if (decision.action !== "allow" && decision.action !== "log") {
      notify(decision);
    }

    switch (decision.action) {
      case "allow":
      case "log":
        emit("allow", decision.reason);
        break;
      case "warn":
        // R11: warn = allow + agent-visible warning. The model sees the
        // reason and is expected to explain itself to the user.
        emit("allow", `[canarywatch warning] ${decision.reason}`);
        break;
      case "pause":
      case "lockdown":
        emit(
          "deny",
          `[canarywatch] Blocked: ${decision.reason} Stop, and tell the user exactly what you were trying to do and why. ` +
            `A human must run \`canarywatch resume ${input.session_id}\` before further tool calls will be allowed.`
        );
        break;
    }
  } catch (err) {
    process.stderr.write(`[canarywatch] unexpected error, allowing (fail-open): ${err}\n`);
    emit("allow", "canarywatch: internal error, allowing by default.");
  }
}

main();
