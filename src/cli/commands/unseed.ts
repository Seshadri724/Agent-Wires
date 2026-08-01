import { unseed } from "../../seeder/seeder.ts";

export function runUnseed(args: string[]): void {
  const workspace = args[0] ?? process.cwd();
  const removed = unseed(workspace);
  console.log(`Removed ${removed.length} canary file(s) from ${workspace}`);
  for (const e of removed) console.log(`  - ${e.path}`);
}
