import { loadPolicy } from "../../core/config.ts";
import { buildManifestPathSet, loadManifest, loadOrCreateKey } from "../../core/manifest.ts";
import { evaluate } from "../../core/policy.ts";
import { loadSession } from "../../core/session.ts";
import { extractPathClaims } from "../../hook/pathClaims.ts";
import type { ToolCallEvent } from "../../core/types.ts";

export function runSimulate(args: string[]): void {
  const toolName = args[0];
  const inputStr = args[1];

  if (!toolName) {
    console.error("Usage: canarywatch simulate <tool-name> [tool-input-json-or-path]");
    console.error("Example: canarywatch simulate Read '{\"file_path\": \".env\"}'");
    process.exitCode = 1;
    return;
  }

  let toolInput: Record<string, unknown> = {};
  if (inputStr) {
    try {
      toolInput = JSON.parse(inputStr);
    } catch {
      toolInput = { file_path: inputStr, command: inputStr, path: inputStr };
    }
  }

  const key = loadOrCreateKey();
  const manifest = loadManifest();
  const manifestPaths = buildManifestPathSet(manifest, key);
  const policy = loadPolicy();
  const state = loadSession("simulated-session", [process.cwd()]);

  const claims = extractPathClaims(toolName, toolInput);
  const event: ToolCallEvent = {
    kind: "tool_call",
    sessionId: "simulated-session",
    tool: toolName,
    paths: claims,
    phase: "pre",
    raw: toolInput,
    ts: Date.now(),
  };

  const decision = evaluate(event, policy, manifestPaths, state);

  console.log(`canarywatch Policy Simulation`);
  console.log(`  Tool:       ${toolName}`);
  console.log(`  Input:      ${JSON.stringify(toolInput)}`);
  console.log(`  Claims:     ${JSON.stringify(claims)}`);
  console.log(`  Decision:   ${decision.action.toUpperCase()}`);
  console.log(`  Detector:   ${decision.detector}`);
  console.log(`  Reason:     ${decision.reason}`);
}
