// MCP Stdio Interception Proxy Gateway for canarywatch.
// docs/ARCHITECTURE.md §3.1, §4.2.
// Intercepts JSON-RPC 2.0 messages for MCP tools/call, evaluates canarywatch
// policy, and blocks unauthorized or tripwire-triggering tool requests.

import readline from "node:readline";
import { spawn } from "node:child_process";
import { loadPolicy } from "../core/config.ts";
import { buildManifestPathSet, buildManifestTokenSet, loadManifest, loadOrCreateKey } from "../core/manifest.ts";
import { evaluate } from "../core/policy.ts";
import { acquireLock, loadSession, saveSession } from "../core/session.ts";
import { getWorkspaceScope } from "../core/scope.ts";
import { appendEvent } from "../core/eventlog.ts";
import { extractPathClaims } from "../hook/pathClaims.ts";
import type { ToolCallEvent } from "../core/types.ts";

export interface McpProxyOptions {
  sessionId?: string;
  cwd?: string;
  mcpServerName?: string;
}

export function startMcpProxy(targetCommand: string, targetArgs: string[], options: McpProxyOptions = {}): void {
  const sessionId = options.sessionId || `mcp-session-${Date.now()}`;
  const cwd = options.cwd || process.cwd();
  const mcpServerName = options.mcpServerName || targetCommand;

  const targetProcess = spawn(targetCommand, targetArgs, {
    cwd,
    stdio: ["pipe", "pipe", "inherit"],
  });

  const rlStdin = readline.createInterface({ input: process.stdin, terminal: false });

  // Relay output from target back to stdout
  targetProcess.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
  });

  targetProcess.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  const key = loadOrCreateKey();
  const manifest = loadManifest();
  const manifestPaths = buildManifestPathSet(manifest, key);
  const canaryTokens = buildManifestTokenSet(manifest, key);
  const policy = loadPolicy();
  const scopeRoots = getWorkspaceScope(cwd);

  rlStdin.on("line", (line) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      targetProcess.stdin.write(line + "\n");
      return;
    }

    if (msg.jsonrpc === "2.0" && msg.method === "tools/call") {
      const id = msg.id;
      const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const toolName = params.name ?? "unknown_mcp_tool";
      const toolArgs = params.arguments ?? {};

      const claims = extractPathClaims(toolName, toolArgs);
      const event: ToolCallEvent = {
        kind: "tool_call",
        sessionId,
        tool: toolName,
        paths: claims,
        phase: "pre",
        raw: { ...toolArgs, mcpServer: mcpServerName },
        ts: Date.now(),
      };

      const release = acquireLock(sessionId);
      let decision: ReturnType<typeof evaluate>;
      try {
        const sessionState = loadSession(sessionId, scopeRoots);
        decision = evaluate(event, policy, manifestPaths, sessionState, canaryTokens);

        if (decision.action === "pause" || decision.action === "lockdown") {
          sessionState.locked = true;
        }

        saveSession(sessionState);
        appendEvent(decision);
      } finally {
        release();
      }

      if (decision.action === "pause" || decision.action === "lockdown") {
        const errorResponse = {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32600,
            message: `[canarywatch] Action denied (${decision.detector}): ${decision.reason}`,
          },
        };
        process.stdout.write(JSON.stringify(errorResponse) + "\n");
        return;
      }
    }

    targetProcess.stdin.write(line + "\n");
  });
}
