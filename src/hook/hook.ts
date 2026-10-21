#!/usr/bin/env node
// The Claude Code PreToolUse hook entrypoint.
// docs/ARCHITECTURE.md §3.2 "Hook Sensor", §3.4 "Response Orchestrator".
//
// Reads the hook JSON Claude Code sends on stdin, evaluates it against
// policy, and writes a permission-decision JSON to stdout. See:
// docs/RESOURCES.md "Claude Code hooks reference" for the wire schema.
//
// Fail-mode policy (docs/ARCHITECTURE.md §6): if we cannot load/verify the
// manifest, we cannot rule out a canary touch, so we fail CLOSED (deny).
// Any other unexpected error fails CLOSED so state or logging failures cannot
// silently turn an enforcement decision into an allow.

import { loadPolicy } from "../core/config.ts";
import { buildManifestPathSet, buildManifestTokenSet, loadManifest, loadOrCreateKey } from "../core/manifest.ts";
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
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
}

const MAX_HOOK_INPUT_BYTES = 1024 * 1024;

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > MAX_HOOK_INPUT_BYTES) {
        process.stdin.pause();
        reject(new Error(`hook input exceeds ${MAX_HOOK_INPUT_BYTES} bytes`));
        return;
      }
      data += chunk;
    });
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
  let raw: string;
  try {
    raw = await readStdin();
  } catch (err) {
    process.stderr.write(`[canarywatch] could not read hook input, failing CLOSED: ${err}\n`);
    emit("deny", "canarywatch: hook input was invalid or too large; denying this action for safety.");
    return;
  }
  let input: ClaudeHookInput;
  try {
    input = JSON.parse(raw);
    if (
      !input ||
      typeof input !== "object" ||
      typeof input.session_id !== "string" ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(input.session_id) ||
      typeof input.cwd !== "string" ||
      input.cwd.length === 0 ||
      input.hook_event_name !== "PreToolUse" ||
      typeof input.tool_name !== "string" ||
      input.tool_name.length === 0 ||
      !input.tool_input ||
      typeof input.tool_input !== "object" ||
      Array.isArray(input.tool_input)
    ) {
      throw new Error("hook input does not match the expected schema");
    }
  } catch (err) {
    process.stderr.write(`[canarywatch] failed to parse hook input, failing CLOSED: ${err}\n`);
    emit("deny", "canarywatch: could not parse hook input, denying this action for safety.");
    return;
  }

  let manifestPaths: Set<string>;
  let canaryTokens: Set<string>;
  try {
    const key = loadOrCreateKey();
    const manifest = loadManifest({ requireEntries: true });
    manifestPaths = buildManifestPathSet(manifest, key);
    canaryTokens = buildManifestTokenSet(manifest, key);
  } catch (err) {
    // Cannot verify canaries -> fail CLOSED. This is the one case where
    // "allowing by default" is worse than a false alarm.
    process.stderr.write(`[canarywatch] manifest unavailable, failing CLOSED: ${err}\n`);
    emit("deny", "canarywatch: could not load the canary manifest, denying by default for safety.");
    return;
  }

  try {
    const policy = loadPolicy();
    const paths = extractPathClaims(input.tool_name, input.tool_input, input.cwd);

    const event: ToolCallEvent = {
      kind: "tool_call",
      sessionId: input.session_id,
      cwd: input.cwd,
      tool: input.tool_name,
      paths,
      phase: "pre",
      raw: input.tool_input,
      ts: Date.now(),
    };

    const release = acquireLock(input.session_id);
    let decision: Decision;
    try {
      const scopeRoots = getWorkspaceScope(input.cwd);
      const state = loadSession(input.session_id, scopeRoots);

      decision = evaluate(event, policy, manifestPaths, state, canaryTokens);

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
    process.stderr.write(`[canarywatch] enforcement error, failing CLOSED: ${err}\n`);
    emit("deny", "canarywatch: enforcement failed, denying this action for safety.");
  }
}

main();
