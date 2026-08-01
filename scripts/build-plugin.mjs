// Bundles the hook binary into a single, dependency-free file inside the
// Claude Code plugin directory, so the plugin works when copied/installed
// on its own — it no longer needs this source checkout or `node_modules`
// present at runtime. docs/ROADMAP.md Phase 1 checkpoint: "package as
// Claude Code plugin"; docs/DEVELOPMENT.md previously tracked this as
// "not yet done".
//
// Output is CommonJS (.cjs) rather than ESM on purpose: a bundled .js
// file's module format would otherwise depend on whatever package.json
// happens to be nearest to it after the plugin is copied elsewhere. A
// .cjs extension is unambiguous to Node regardless of surrounding files.

import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

await build({
  entryPoints: [path.join(repoRoot, "src", "hook", "hook.ts")],
  outfile: path.join(repoRoot, "plugin", "claude-code", "bin", "hook.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  minify: false,
  sourcemap: false,
  banner: {
    // No shebang here: esbuild already hoists the one from src/hook/hook.ts
    // itself to the top of the bundle. Adding another would duplicate it
    // and break `node hook.cjs` (only the true first line is stripped).
    js: "// GENERATED FILE — built from src/hook/hook.ts by scripts/build-plugin.mjs. Do not edit directly.",
  },
});

console.log("Built plugin/claude-code/bin/hook.cjs");
