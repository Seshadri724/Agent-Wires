// The policy engine. Pure and synchronous — no I/O — so it can run
// identically in the hook, the future daemon, and the future server side.
// docs/ARCHITECTURE.md §3.3, docs/THREAT-MODEL.md §2.
//
// evaluate() takes an already-built event + already-loaded manifest/policy/
// session and returns a Decision. Callers own persistence and I/O.

import { canonicalize, globMatch, isSubpathOrEqual } from "./canonicalize.ts";
import type {
  Access,
  Decision,
  DetectorId,
  PathClaim,
  PolicyConfig,
  SessionState,
  ToolCallEvent,
} from "./types.ts";

const SEVERITY: Record<Decision["action"], number> = {
  allow: 0,
  log: 1,
  warn: 2,
  pause: 3,
  lockdown: 4,
};

interface ClaimVerdict {
  action: Decision["action"];
  detector: DetectorId;
  reason: string;
}

function isExempt(state: SessionState, claim: PathClaim, now: number): boolean {
  return state.exemptions.some((ex) => {
    if (ex.expiresAt && new Date(ex.expiresAt).getTime() < now) return false;
    if (ex.sessionOnly && ex.sessionId !== state.sessionId) return false;
    if (ex.access !== "any" && ex.access !== claim.access) return false;
    return isSubpathOrEqual(ex.scope, claim.path);
  });
}

function evaluateCanary(claim: PathClaim, manifestPaths: Set<string>): ClaimVerdict | null {
  if (!manifestPaths.has(claim.path)) return null;
  if (claim.access === "list") {
    return { action: "log", detector: "D1", reason: `Canary path listed (not read): ${claim.path}` };
  }
  return {
    action: "pause",
    detector: "D1",
    reason: `Canary touch: ${claim.access} on ${claim.path}. This path exists only as a tripwire — no legitimate task needs it.`,
  };
}

function evaluateSensitive(claim: PathClaim, policy: PolicyConfig): ClaimVerdict | null {
  const hit = policy.sensitivePaths.some((pattern) => globMatch(pattern, claim.path));
  if (!hit) return null;
  if (claim.access === "list") {
    return { action: "log", detector: "D2", reason: `Sensitive path listed: ${claim.path}` };
  }
  return {
    action: "pause",
    detector: "D2",
    reason: `Sensitive-path access: ${claim.access} on ${claim.path}. Requires explicit approval.`,
  };
}

function evaluateScope(claim: PathClaim, policy: PolicyConfig, state: SessionState): ClaimVerdict | null {
  if (!policy.scopeEnforced) return null;
  if (claim.access !== "write" && claim.access !== "delete") return null;
  if (state.scopeRoots.length === 0) return null; // no declared scope = no enforcement
  const inScope = state.scopeRoots.some((root) => isSubpathOrEqual(root, claim.path));
  if (inScope) return null;
  const escalate = state.scopeViolations >= policy.d3.warnBeforePause;
  return {
    action: escalate ? "pause" : "warn",
    detector: "D3",
    reason: `Write outside declared scope: ${claim.path} is not under [${state.scopeRoots.join(", ")}].`,
  };
}

function evaluateMassMod(
  claim: PathClaim,
  policy: PolicyConfig,
  state: SessionState,
  now: number,
  phase: "pre" | "post" = "pre"
): ClaimVerdict | null {
  if (claim.access !== "write" && claim.access !== "delete") return null;
  const segments = claim.path.split(/[\\/]/);
  if (segments.some((seg) => policy.massMod.allowlistDirs.includes(seg))) return null;

  const windowStart = now - policy.massMod.windowMs;
  const recent = state.writeTimestamps.filter((t) => t >= windowStart);
  if (phase === "pre") {
    recent.push(now);
  }
  state.writeTimestamps = recent;

  if (recent.length <= policy.massMod.threshold) return null;
  return {
    action: "pause",
    detector: "D4",
    reason: `Mass modification: ${recent.length} writes in ${policy.massMod.windowMs}ms (threshold ${policy.massMod.threshold}).`,
  };
}

function isShellTool(toolName: string): boolean {
  if (toolName === "Bash") return true;
  return /bash|exec|shell|terminal|run_command|execute/i.test(toolName);
}

function evaluateDangerousCommand(event: ToolCallEvent, policy: PolicyConfig): ClaimVerdict | null {
  if (!isShellTool(event.tool)) return null;
  const rawObj = (event.raw ?? {}) as Record<string, unknown>;
  const command = typeof rawObj.command === "string" ? rawObj.command : typeof rawObj.cmd === "string" ? rawObj.cmd : event.paths.map((p) => p.path).join(" ");
  if (!command) return null;

  const patterns = policy.dangerousCommands ?? [
    "rm -rf /",
    "rm -rf /*",
    "mkfs",
    "dd if=",
    "chmod 777",
    "chown -R",
    "curl * | bash",
    "curl * | sh",
    "wget * | bash",
    "wget * | sh",
    "eval $(curl",
    "eval $(wget",
    "base64 -d | bash",
    "nc -e",
    "tmate",
    "ngrok",
  ];

  const normalizedCmd = command.toLowerCase();
  for (const pat of patterns) {
    const escapedPat = pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
    const reg = new RegExp(escapedPat, "i");
    if (reg.test(normalizedCmd)) {
      return {
        action: "pause",
        detector: "D5",
        reason: `Dangerous shell command pattern detected ('${pat}'). Execution blocked for safety.`,
      };
    }
  }
  return null;
}

function evaluateToolAuthorization(event: ToolCallEvent, policy: PolicyConfig): ClaimVerdict | null {
  const mcp = policy.mcp;
  if (!mcp) return null;

  const rawObj = (event.raw ?? {}) as Record<string, unknown>;
  const serverName = typeof rawObj.mcpServer === "string" ? rawObj.mcpServer : undefined;

  if (serverName && mcp.blockedServers?.includes(serverName)) {
    return {
      action: "pause",
      detector: "D6",
      reason: `Blocked MCP server execution: '${serverName}'.`,
    };
  }

  if (serverName && mcp.allowedServers && !mcp.allowedServers.includes("*") && !mcp.allowedServers.includes(serverName)) {
    return {
      action: "pause",
      detector: "D6",
      reason: `Unapproved MCP server execution: '${serverName}' is not in allowed list.`,
    };
  }

  if (mcp.blockedTools?.includes(event.tool)) {
    return {
      action: "pause",
      detector: "D6",
      reason: `Blocked tool execution: '${event.tool}'.`,
    };
  }

  if (mcp.allowedTools && !mcp.allowedTools.includes("*") && !mcp.allowedTools.includes(event.tool)) {
    return {
      action: "pause",
      detector: "D6",
      reason: `Unapproved tool execution: '${event.tool}' is not in allowed list.`,
    };
  }

  return null;
}

function evaluateTokenReuse(event: ToolCallEvent, canaryTokens: Set<string>): ClaimVerdict | null {
  if (canaryTokens.size === 0) return null;
  const haystack = JSON.stringify(event.raw ?? "");
  if (!haystack) return null;
  for (const token of canaryTokens) {
    if (haystack.includes(token)) {
      return {
        action: "pause",
        detector: "D1",
        reason: "Canary secret appeared in a later tool call. The bait was read or copied — this is not a legitimate task.",
      };
    }
  }
  return null;
}

function evaluateExfiltration(event: ToolCallEvent, policy: PolicyConfig, manifestPaths: Set<string>): ClaimVerdict | null {
  if (!isShellTool(event.tool)) return null;
  const rawObj = (event.raw ?? {}) as Record<string, unknown>;
  const command = typeof rawObj.command === "string" ? rawObj.command : typeof rawObj.cmd === "string" ? rawObj.cmd : "";
  if (!command) return null;

  const isOutboundCmd = /\b(curl|wget|nc|ncat|socat|scp|rsync|ssh)\b/i.test(command);
  if (!isOutboundCmd) return null;

  // Check if command references sensitive paths or canaries
  for (const claim of event.paths) {
    const canonicalPath = canonicalize(claim.path);
    const isCanary = manifestPaths.has(canonicalPath);
    const isSensitive = policy.sensitivePaths.some((p) => globMatch(p, canonicalPath));
    if (isCanary || isSensitive) {
      return {
        action: "pause",
        detector: "D7",
        reason: `Outbound data exfiltration attempt detected: sharing protected file (${claim.path}) via network command.`,
      };
    }
  }

  return null;
}

function worst(a: ClaimVerdict | null, b: ClaimVerdict | null): ClaimVerdict | null {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY[b.action] > SEVERITY[a.action] ? b : a;
}

/**
 * Evaluate one tool-call event against policy + manifest + session state.
 * Mutates `state` in place (write-timestamp window, scope-violation count)
 * — callers persist it after calling evaluate().
 */
export function evaluate(
  event: ToolCallEvent,
  policy: PolicyConfig,
  manifestPaths: Set<string>,
  state: SessionState,
  canaryTokens: Set<string> = new Set()
): Decision {
  const now = event.ts;

  if (state.locked) {
    return {
      action: "lockdown",
      detector: "none",
      reason: "Session is locked pending human review. Run `canarywatch resume <session>` to continue.",
      evidence: { sessionId: event.sessionId, tool: event.tool, paths: event.paths.map((p) => p.path), ts: now },
    };
  }

  const rawObj = (event.raw ?? {}) as Record<string, unknown>;
  const mcpServer = typeof rawObj.mcpServer === "string" ? rawObj.mcpServer : undefined;

  let best: ClaimVerdict | null = worst(
    evaluateTokenReuse(event, canaryTokens),
    worst(
      evaluateDangerousCommand(event, policy),
      worst(evaluateToolAuthorization(event, policy), evaluateExfiltration(event, policy, manifestPaths))
    )
  );

  for (const claim of event.paths) {
    const canonical = { ...claim, path: canonicalize(claim.path) };
    if (isExempt(state, canonical, now)) continue;

    const canary = evaluateCanary(canonical, manifestPaths);
    const sensitive = evaluateSensitive(canonical, policy);
    const scope = evaluateScope(canonical, policy, state);
    const massMod = evaluateMassMod(canonical, policy, state, now, event.phase);

    best = worst(best, worst(worst(canary, sensitive), worst(scope, massMod)));
  }

  if (best?.detector === "D3" && best.action === "warn") {
    state.scopeViolations += 1;
  }

  if (!best) {
    return {
      action: "allow",
      detector: "none",
      reason: "No policy match.",
      evidence: { sessionId: event.sessionId, tool: event.tool, paths: event.paths.map((p) => p.path), ts: now, mcpServer },
    };
  }

  return {
    action: best.action,
    detector: best.detector,
    reason: best.reason,
    evidence: { sessionId: event.sessionId, tool: event.tool, paths: event.paths.map((p) => p.path), ts: now, mcpServer },
  };
}

export function grantExemption(
  state: SessionState,
  scope: string,
  access: Access | "any",
  sessionOnly: boolean,
  ttlMs?: number
): void {
  state.exemptions.push({
    scope: canonicalize(scope),
    access,
    sessionOnly,
    sessionId: sessionOnly ? state.sessionId : undefined,
    grantedAt: new Date().toISOString(),
    expiresAt: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : undefined,
  });
}
