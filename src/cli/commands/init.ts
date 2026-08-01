import { seed } from "../../seeder/seeder.ts";
import { ensurePolicyFile } from "../../core/config.ts";
import { canarywatchHome } from "../../core/home.ts";
import { runInstallHook } from "./installHook.ts";

export function runInit(args: string[]): void {
  const workspace = args[0] ?? process.cwd();
  ensurePolicyFile();
  const result = seed(workspace, "standard");

  console.log(`canarywatch: protected ${workspace}`);
  console.log(`  seeded ${result.seeded.length} canary file(s)`);
  if (result.skipped.length > 0) {
    console.log(`  skipped ${result.skipped.length} path(s) that already existed (never overwritten)`);
  }
  console.log(`  state directory: ${canarywatchHome()}`);
  console.log("");
  console.log("Automatically registering canarywatch hooks...");
  runInstallHook(args);
  console.log("");
  console.log("Run `canarywatch test` to verify the tripwire fires.");
}
