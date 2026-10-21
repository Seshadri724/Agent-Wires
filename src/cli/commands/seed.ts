import { seed, type Density } from "../../seeder/seeder.ts";

export function runSeed(args: string[]): void {
  const workspace = args.find((a) => !a.startsWith("--")) ?? process.cwd();
  const densityFlag = args.find((a) => a.startsWith("--density="));
  const density = (densityFlag ? densityFlag.split("=")[1] : "standard") as Density;
  if (!["light", "standard", "paranoid"].includes(density)) {
    console.error(`Invalid density '${density}'. Choose light, standard, or paranoid.`);
    process.exitCode = 1;
    return;
  }

  const result = seed(workspace, density);
  console.log(`Seeded ${result.seeded.length} canary file(s) in ${workspace} (density: ${density})`);
  for (const e of result.seeded) console.log(`  + ${e.path}`);
  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length} path(s) that already existed:`);
    for (const s of result.skipped) console.log(`  ~ ${s}`);
  }
}
