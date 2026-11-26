import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const artifacts = [
  ["source", "src/cli/cli.ts"],
  ["plugin", "plugin/claude-code/bin/canarywatch.mjs"],
  ["beta", "dist/canarywatch-beta/bin/canarywatch.mjs"],
];
let expectedScenarios;

for (const [name, entry] of artifacts) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, entry), "evaluate", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${name} evaluation failed: ${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.overallPass, true, `${name} evaluation did not pass`);
  assert.equal(report.canarywatchVersion, packageJson.version, `${name} reported the wrong package version`);
  assert.equal(report.summary.total, 13, `${name} reported an unexpected scenario count`);
  assert.equal(report.summary.passed, 13, `${name} had failed scenarios`);
  assert.equal(report.summary.blocked, 9, `${name} reported unexpected blocked count`);
  assert.equal(report.summary.allowed, 3, `${name} reported unexpected allowed count`);
  assert.equal(report.summary.unobserved, 1, `${name} reported unexpected unobserved count`);
  assert.ok(report.contractNotice && report.contractNotice.includes("not a security score"));
  assert.equal(report.$id, "https://raw.githubusercontent.com/Seshadri724/Agent-Wires/master/schemas/evaluation-v1.schema.json");
  assert.ok(fs.existsSync(path.join(repoRoot, "schemas", "evaluation-v1.schema.json")));

  const outcomes = report.scenarios.map(({ name: scenario, expectedDecision, actualDecision, detector, pass }) =>
    [scenario, expectedDecision, actualDecision, detector, pass]);
  if (expectedScenarios) assert.deepEqual(outcomes, expectedScenarios, `${name} scenario outcomes differ`);
  else expectedScenarios = outcomes;
  console.log(`${name}: ${report.summary.passed}/${report.summary.total} evaluation scenarios passed`);
}
