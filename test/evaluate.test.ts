import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  executeEvaluation,
  runEvaluate,
  CANARYWATCH_VERSION,
  EVALUATION_SCHEMA_VERSION,
  EVALUATION_SCHEMA_URL,
  EVALUATION_SCHEMA_ID,
  type EvaluationReport,
} from "../src/cli/commands/evaluate.ts";

test("canarywatch evaluate contract", async (t) => {
  await t.test("all expected scenarios pass with current policy", async () => {
    const report = await executeEvaluation();

    assert.equal(report.schemaVersion, EVALUATION_SCHEMA_VERSION);
    assert.equal(report.canarywatchVersion, CANARYWATCH_VERSION);
    assert.equal(report.overallPass, true);
    assert.equal(report.summary.total, 13);
    assert.equal(report.summary.passed, 13);
    assert.equal(report.summary.failed, 0);
    assert.equal(report.summary.blocked, 9);
    assert.equal(report.summary.allowed, 3);
    assert.equal(report.summary.unobserved, 1);
    assert.match(report.contractNotice, /not a security score/i);

    const scenarioNames = report.scenarios.map((s) => s.name);
    assert.deepEqual(scenarioNames, [
      "canary-read-denied",
      "broad-listing-allowed",
      "ordinary-read-allowed",
      "sensitive-path-read-denied",
      "session-lock-denial",
      "token-reuse-denied",
      "mass-modification-denied",
      "scope-warning",
      "scope-denial",
      "dangerous-shell-denied",
      "mcp-server-denied",
      "protected-upload-denied",
      "raw-socket-exfiltration-unobserved",
    ]);

    for (const s of report.scenarios) {
      assert.equal(s.pass, true, `Scenario ${s.name} should pass`);
      assert.equal(s.actualDecision, s.expectedDecision, `Scenario ${s.name} decision mismatch`);
      if (s.expectedDetector) assert.equal(s.detector, s.expectedDetector, `Scenario ${s.name} detector mismatch`);
      assert.ok(s.intendedBehavior.length > 0, `Scenario ${s.name} missing intendedBehavior`);
      assert.ok(s.coverageLimit.length > 0, `Scenario ${s.name} missing coverageLimit`);
      assert.ok(s.reason && s.reason.length > 0, `Scenario ${s.name} missing reason`);
    }

    const canaryRead = report.scenarios.find((s) => s.name === "canary-read-denied")!;
    assert.equal(canaryRead.detector, "D1");
    assert.equal(canaryRead.expectedDecision, "deny");

    const broadListing = report.scenarios.find((s) => s.name === "broad-listing-allowed")!;
    assert.equal(broadListing.expectedDecision, "allow");

    const ordinaryRead = report.scenarios.find((s) => s.name === "ordinary-read-allowed")!;
    assert.equal(ordinaryRead.expectedDecision, "allow");

    const sensitiveRead = report.scenarios.find((s) => s.name === "sensitive-path-read-denied")!;
    assert.equal(sensitiveRead.detector, "D2");
    assert.equal(sensitiveRead.expectedDecision, "deny");

    const sessionLock = report.scenarios.find((s) => s.name === "session-lock-denial")!;
    assert.equal(sessionLock.expectedDecision, "deny");

    const tokenReuse = report.scenarios.find((s) => s.name === "token-reuse-denied")!;
    assert.equal(tokenReuse.detector, "D1");
    assert.equal(tokenReuse.expectedDecision, "deny");

    const massMod = report.scenarios.find((s) => s.name === "mass-modification-denied")!;
    assert.equal(massMod.detector, "D4");
    assert.equal(massMod.expectedDecision, "deny");

    for (const [name, detector, decision] of [
      ["scope-warning", "D3", "allow"],
      ["scope-denial", "D3", "deny"],
      ["dangerous-shell-denied", "D5", "deny"],
      ["mcp-server-denied", "D6", "deny"],
      ["protected-upload-denied", "D7", "deny"],
    ]) {
      const scenario = report.scenarios.find((s) => s.name === name)!;
      assert.equal(scenario.detector, detector);
      assert.equal(scenario.expectedDecision, decision);
    }

    const unobserved = report.scenarios.find((s) => s.name === "raw-socket-exfiltration-unobserved")!;
    assert.equal(unobserved.category, "unobserved");
    assert.equal(unobserved.boundary, "outside_supported_boundary");
    assert.equal(unobserved.actualDecision, "allow");
    assert.equal(unobserved.pass, true);
  });

  await t.test("a failed decision makes the evaluation report fail", async () => {
    // Override policy to exclude sensitive paths; .env read will allow instead of deny
    const failReport = await executeEvaluation({
      policyOverride: (policy) => ({ ...policy, sensitivePaths: [] }),
    });

    assert.equal(failReport.overallPass, false);
    assert.ok(failReport.summary.failed > 0);

    const sensitiveScenario = failReport.scenarios.find((s) => s.name === "sensitive-path-read-denied")!;
    assert.equal(sensitiveScenario.expectedDecision, "deny");
    assert.equal(sensitiveScenario.actualDecision, "allow");
    assert.equal(sensitiveScenario.pass, false);
  });

  await t.test("JSON execution errors return one clean, parseable failure report", async () => {
    const oldLog = console.log;
    const oldError = console.error;
    const oldExitCode = process.exitCode;
    const output: string[] = [];
    console.log = (...values: unknown[]) => output.push(values.join(" "));
    console.error = () => {};
    try {
      const report = await runEvaluate(["--json"], async () => {
        throw new Error("failure with a private path C:\\Users\\someone\\secret.txt");
      });
      assert.equal(process.exitCode, 1);
      assert.equal(report.overallPass, false);
      assert.equal(report.summary.total, 0);
      assert.equal(report.summary.failed, 0);
      assert.equal(report.error, "Evaluation could not complete.");
      assert.equal(output.length, 1);
      assert.deepEqual(JSON.parse(output[0]), report);
      assert.ok(!output[0].includes("someone"));
    } finally {
      console.log = oldLog;
      console.error = oldError;
      process.exitCode = oldExitCode;
    }
  });

  await t.test("unknown options fail without starting evaluation", async () => {
    const oldLog = console.log;
    const oldError = console.error;
    const oldExitCode = process.exitCode;
    const output: string[] = [];
    console.log = (...values: unknown[]) => output.push(values.join(" "));
    console.error = () => {};
    try {
      const report = await runEvaluate(["--json", "--typo"], async () => {
        throw new Error("evaluation should not run");
      });
      assert.equal(process.exitCode, 1);
      assert.equal(report.error, "Unsupported option: --typo");
      assert.equal(output.length, 1);
      assert.deepEqual(JSON.parse(output[0]), report);
    } finally {
      console.log = oldLog;
      console.error = oldError;
      process.exitCode = oldExitCode;
    }
  });

  await t.test("temporary state is cleaned up after success and after failure", async () => {
    const getTempDirs = () =>
      fs
        .readdirSync(os.tmpdir())
        .filter((name) => name.startsWith("canarywatch-eval-"));

    const initialDirs = getTempDirs();
    const envBeforeFailure = process.env.CANARYWATCH_HOME;

    // Successful run cleans up
    await executeEvaluation();
    const dirsAfterSuccess = getTempDirs();
    assert.deepEqual(
      dirsAfterSuccess.filter((d) => !initialDirs.includes(d)),
      [],
      "No temporary evaluation directories should remain after success"
    );

    // Run with an invalid hook that throws cleans up in finally
    await assert.rejects(
      () => executeEvaluation({ hookPath: path.join(os.tmpdir(), "nonexistent-hook.js") }),
      /could not locate|hook process failed|ENOENT/
    );
    assert.equal(process.env.CANARYWATCH_HOME, envBeforeFailure, "CANARYWATCH_HOME should be restored after failure");

    const dirsAfterFailure = getTempDirs();
    assert.deepEqual(
      dirsAfterFailure.filter((d) => !initialDirs.includes(d)),
      [],
      "No temporary evaluation directories should remain after failure"
    );
  });

  await t.test("JSON output is valid, structured, and excludes raw secrets or machine paths", () => {
    const res = spawnSync(process.execPath, ["src/cli/cli.ts", "evaluate", "--json"], {
      encoding: "utf8",
      env: { ...process.env },
    });

    assert.equal(res.status, 0, `evaluate --json failed: ${res.stderr}`);
    const parsed = JSON.parse(res.stdout) as EvaluationReport;

    assert.equal(parsed.$schema, EVALUATION_SCHEMA_URL);
    assert.equal(parsed.$id, EVALUATION_SCHEMA_ID);
    assert.equal(parsed.schemaVersion, EVALUATION_SCHEMA_VERSION);
    assert.equal(parsed.canarywatchVersion, CANARYWATCH_VERSION);
    assert.ok(!isNaN(Date.parse(parsed.timestamp)));
    assert.equal(parsed.overallPass, true);
    assert.equal(parsed.scenarios.length, 13);
    assert.equal(parsed.summary.total, 13);
    assert.equal(parsed.summary.unobserved, 1);

    // Verify raw secret patterns do not leak into the JSON output
    const rawOutput = res.stdout;
    assert.ok(!rawOutput.includes("sk-"), "No OpenAI API key format in output");
    assert.ok(!rawOutput.includes("AKIA"), "No AWS key format in output");
    assert.ok(!rawOutput.includes("ghp_"), "No GitHub token format in output");

    // Verify machine-specific temporary directories are sanitized
    const tmpDir = os.tmpdir();
    assert.ok(
      !rawOutput.includes(path.join(tmpDir, "canarywatch-eval-")),
      "No machine-specific temp directory paths in JSON output"
    );

    for (const s of parsed.scenarios) {
      if (s.reason) {
        assert.ok(
          !s.reason.includes(tmpDir),
          `Reason in ${s.name} should not contain machine temp path: ${s.reason}`
        );
      }
    }
  });

  await t.test("published report schema matches the output contract", () => {
    const schema = JSON.parse(fs.readFileSync(path.join(process.cwd(), "schemas/evaluation-v1.schema.json"), "utf8"));
    assert.equal(schema.$id, EVALUATION_SCHEMA_ID);
    assert.equal(schema.properties.$schema.const, EVALUATION_SCHEMA_URL);
    assert.ok(schema.required.includes("scenarios"));
    assert.ok(schema.properties.scenarios.items.properties.expectedDetector);
    assert.ok(schema.properties.error);
  });

  await t.test("leaves caller's workspace and Canarywatch state unchanged", async () => {
    const cwd = process.cwd();
    const filesBefore = fs.readdirSync(cwd);
    const callerHome = fs.mkdtempSync(path.join(os.tmpdir(), "cw-caller-home-"));
    fs.writeFileSync(path.join(callerHome, "sentinel.txt"), "keep\n");
    const envBefore = process.env.CANARYWATCH_HOME;
    process.env.CANARYWATCH_HOME = callerHome;

    try {
      const stateFilesBefore = fs.readdirSync(callerHome);
      await executeEvaluation();

      const filesAfter = fs.readdirSync(cwd);
      assert.deepEqual(filesAfter, filesBefore, "Workspace directory files should be untouched");
      assert.equal(process.env.CANARYWATCH_HOME, callerHome, "CANARYWATCH_HOME env var should be restored");
      assert.deepEqual(fs.readdirSync(callerHome), stateFilesBefore, "Caller state directory files should be untouched");
    } finally {
      if (envBefore === undefined) delete process.env.CANARYWATCH_HOME;
      else process.env.CANARYWATCH_HOME = envBefore;
      fs.rmSync(callerHome, { recursive: true, force: true });
    }
  });
});
