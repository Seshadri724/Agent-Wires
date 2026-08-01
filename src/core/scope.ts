// Declared scope roots per workspace (docs/ARCHITECTURE.md §3.3 D3,
// docs/THREAT-MODEL.md §5 D3 mitigation: "session scope is declarable").
// A brand-new session inherits the workspace's declared scope roots;
// `canarywatch scope add` extends it for multi-root tasks.

import fs from "node:fs";
import path from "node:path";
import { scopeFileFor } from "./home.ts";
import { canonicalize } from "./canonicalize.ts";

interface ScopeFile {
  roots: string[];
}

export function getWorkspaceScope(workspace: string): string[] {
  const f = scopeFileFor(workspace);
  if (!fs.existsSync(f)) return [canonicalize(workspace)];
  const data = JSON.parse(fs.readFileSync(f, "utf8")) as ScopeFile;
  return data.roots;
}

export function addWorkspaceScopeRoot(workspace: string, root: string): string[] {
  const f = scopeFileFor(workspace);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const current = getWorkspaceScope(workspace);
  const canonicalRoot = canonicalize(root);
  if (!current.includes(canonicalRoot)) current.push(canonicalRoot);
  fs.writeFileSync(f, JSON.stringify({ roots: current }, null, 2));
  return current;
}
