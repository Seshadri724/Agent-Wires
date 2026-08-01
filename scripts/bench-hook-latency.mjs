// Latency benchmark for docs/ROADMAP.md Phase 1 checkpoint:
// "p99 hook decision latency < 50 ms" (see docs/ARCHITECTURE.md §3.2,
// which scopes that budget to the *decision logic itself* — manifest
// lookup + policy evaluation — not full OS process spawn time).
//
// Measures three things separately so the budget is checked against the
// right layer:
//   1. evaluate() in-process   — the actual number the <50ms budget is about
//   2. dev-mode subprocess     — `node src/hook/hook.ts` end-to-end
//   3. bundled-binary subprocess — `node plugin/claude-code/bin/hook.cjs` end-to-end
//
// (2) and (3) are dominated by Node's own process cold-start, which no
// amount of canarywatch optimization changes — that's exactly why
// docs/ROADMAP.md Phase 2 (a long-lived daemon, not a fresh process per
// tool call) exists as the eventual path to lower steady-state overhead.
// This script exists to make that distinction measured, not assumed.

import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

// Dynamic import() requires a file:// URL for absolute Windows paths
// (a raw "C:\..." string is parsed as a URL with scheme "c:", which the
// ESM loader rejects) — every dynamic import of a repo-relative module
// below goes through this.
function importFrom(...segments) {
  return import(pathToFileURL(path.join(repoRoot, ...segments)).href);
}

function percentile(sortedMs, p) {
  const idx = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[idx];
}

function report(label, samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p99 = percentile(sorted, 99);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  console.log(
    `${label.padEnd(34)} p50=${p50.toFixed(2).padStart(8)}ms  p99=${p99.toFixed(2).padStart(8)}ms  min=${min.toFixed(2).padStart(7)}ms  max=${max.toFixed(2).padStart(8)}ms  (n=${sorted.length})`
  );
}

async function benchEvaluateInProcess(home, workspace, n) {
  process.env.CANARYWATCH_HOME = home;
  const { loadPolicy } = await importFrom("src", "core", "config.ts");
  const { loadManifest, loadOrCreateKey, buildManifestPathSet } = await importFrom("src", "core", "manifest.ts");
  const { evaluate } = await importFrom("src", "core", "policy.ts");
  const { loadSession } = await importFrom("src", "core", "session.ts");

  const policy = loadPolicy();
  const key = loadOrCreateKey();
  const manifest = loadManifest();
  const manifestPaths = buildManifestPathSet(manifest, key);
  const state = loadSession("bench-inprocess", [workspace]);

  const normalFile = path.join(workspace, "normal-file.txt");
  fs.writeFileSync(normalFile, "hi\n");

  const samples = [];
  // Warmup (JIT, disk cache) — not counted.
  for (let i = 0; i < 200; i++) {
    evaluate(
      { kind: "tool_call", sessionId: "bench-inprocess", tool: "Read", paths: [{ path: normalFile, access: "read", confidence: "exact" }], phase: "pre", ts: Date.now() },
      policy,
      manifestPaths,
      state
    );
  }
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    evaluate(
      { kind: "tool_call", sessionId: "bench-inprocess", tool: "Read", paths: [{ path: normalFile, access: "read", confidence: "exact" }], phase: "pre", ts: Date.now() },
      policy,
      manifestPaths,
      state
    );
    samples.push(performance.now() - start);
  }
  return samples;
}

function benchSubprocess(hookPath, home, workspace, n) {
  const normalFile = path.join(workspace, "normal-file.txt");
  fs.writeFileSync(normalFile, "hi\n");
  const input = JSON.stringify({
    session_id: "bench-subprocess",
    cwd: workspace,
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_input: { file_path: normalFile },
  });

  const samples = [];
  // Warmup — first couple of spawns pay one-time OS/disk-cache costs.
  for (let i = 0; i < 3; i++) {
    spawnSync(process.execPath, [hookPath], { input, env: { ...process.env, CANARYWATCH_HOME: home }, encoding: "utf8" });
  }
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    spawnSync(process.execPath, [hookPath], { input, env: { ...process.env, CANARYWATCH_HOME: home }, encoding: "utf8" });
    samples.push(performance.now() - start);
  }
  return samples;
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-bench-"));
  const home = path.join(tmpRoot, "home");
  const workspace = path.join(tmpRoot, "workspace");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });

  const { seed } = await importFrom("src", "seeder", "seeder.ts");
  process.env.CANARYWATCH_HOME = home;
  seed(workspace, "standard");

  const N_INPROCESS = 5000;
  const N_SUBPROCESS = 30;

  console.log("canarywatch hook latency benchmark");
  console.log(`  workspace: ${workspace}`);
  console.log(`  home:      ${home}`);
  console.log("");

  const inProcess = await benchEvaluateInProcess(home, workspace, N_INPROCESS);
  report("evaluate() in-process", inProcess);

  const devMode = benchSubprocess(path.join(repoRoot, "src", "hook", "hook.ts"), home, workspace, N_SUBPROCESS);
  report("dev-mode subprocess (hook.ts)", devMode);

  const bundlePath = path.join(repoRoot, "plugin", "claude-code", "bin", "hook.cjs");
  if (fs.existsSync(bundlePath)) {
    const bundled = benchSubprocess(bundlePath, home, workspace, N_SUBPROCESS);
    report("bundled subprocess (hook.cjs)", bundled);
  } else {
    console.log("(bundled hook.cjs not found — run `npm run build:plugin` first)");
  }

  console.log("");
  console.log("docs/ARCHITECTURE.md's <50ms p99 budget is for the 'evaluate() in-process' row —");
  console.log("the decision logic itself. The subprocess rows are dominated by Node's own cold");
  console.log("start, which is a process-spawn cost, not a canarywatch cost; see this script's");
  console.log("header comment and docs/ROADMAP.md Phase 2 for the long-lived-daemon path that");
  console.log("removes it from the steady-state hot path.");

  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

main();
