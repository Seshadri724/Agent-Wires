import { addWorkspaceScopeRoot, getWorkspaceScope } from "../../core/scope.ts";

export function runScope(args: string[]): void {
  const [sub, ...rest] = args;
  const workspace = process.cwd();

  if (sub === "add") {
    const root = rest[0];
    if (!root) {
      console.error("Usage: canarywatch scope add <path>");
      process.exitCode = 1;
      return;
    }
    const roots = addWorkspaceScopeRoot(workspace, root);
    console.log(`Scope for ${workspace}:`);
    for (const r of roots) console.log(`  ${r}`);
    return;
  }

  if (sub === "list" || !sub) {
    const roots = getWorkspaceScope(workspace);
    console.log(`Scope for ${workspace}:`);
    for (const r of roots) console.log(`  ${r}`);
    return;
  }

  console.error(`Unknown scope subcommand: ${sub}. Use "add <path>" or "list".`);
  process.exitCode = 1;
}
