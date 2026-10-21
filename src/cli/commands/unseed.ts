import { unseed } from "../../seeder/seeder.ts";

export function runUnseed(args: string[]): void {
  const workspace = args[0] ?? process.cwd();
  const result = unseed(workspace);
  console.log(`Removed ${result.removed.length} unchanged canary file(s) from ${workspace}`);
  for (const e of result.removed) console.log(`  - ${e.path}`);
  if (result.preservedModified.length > 0) {
    console.warn("Preserved modified canary paths to avoid deleting user data:");
    for (const e of result.preservedModified) console.warn(`  - ${e.path}`);
  }
}
