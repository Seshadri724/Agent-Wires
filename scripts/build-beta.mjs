// Assembles the tester-facing beta artifact into dist/canarywatch-beta/:
// the plugin (hook.cjs + manifests) plus a bundled CLI, so a tester can run
// `resume` when a tripwire locks their session. Without the CLI they'd have
// to hand-delete JSON out of ~/.canarywatch/sessions — see src/cli/commands/resume.ts.
//
// Minified on purpose: this is what leaves the building, and it should not
// carry comments and readable source with it. That's a speed bump, not
// protection — the real reason to run this is that it ships *only* the two
// bundles, never src/, tests, or docs.

import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "dist", "canarywatch-beta");

fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync(path.join(repoRoot, "plugin", "claude-code"), outDir, { recursive: true });
fs.rmSync(path.join(outDir, "README.md"), { force: true }); // dev-facing, not for testers

// ESM (.mjs), unlike the hook's .cjs bundle: the CLI resolves its own paths
// via import.meta.url (installHook.ts, test.ts), which a CJS bundle leaves
// empty — install-hook would then register a hook path pointing at nothing.
// .mjs is as unambiguous to Node as .cjs, so the reason build-plugin.mjs
// avoids a bare .js still holds.
await build({
  entryPoints: [path.join(repoRoot, "src", "cli", "cli.ts")],
  outfile: path.join(outDir, "bin", "canarywatch.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
});

console.log(`Built ${path.relative(repoRoot, outDir)}`);
for (const f of fs.readdirSync(outDir, { recursive: true })) console.log(`  ${f}`);
