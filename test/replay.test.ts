import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { appendEvent, exportEventsJson, exportEventsOcsf, getEventsForSession } from "../src/core/eventlog.ts";
import type { Decision } from "../src/core/types.ts";

test("session events and replay export", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-replay-"));
  const prevHome = process.env.CANARYWATCH_HOME;
  process.env.CANARYWATCH_HOME = tmpDir;

  try {
    const decision: Decision = {
      action: "pause",
      detector: "D1",
      reason: "Canary touched",
      evidence: {
        sessionId: "replay-sess-1",
        tool: "Read",
        paths: [path.join(tmpDir, "canary.txt")],
        ts: Date.now(),
      },
    };

    appendEvent(decision);

    const sessionEvents = getEventsForSession("replay-sess-1");
    assert.equal(sessionEvents.length, 1);
    assert.equal(sessionEvents[0].decision.detector, "D1");

    const jsonExport = exportEventsJson("replay-sess-1");
    assert.match(jsonExport, /replay-sess-1/);
    assert.match(jsonExport, /Canary touched/);
    const parsed = JSON.parse(jsonExport);
    assert.equal(parsed.redacted, true);
    assert.equal(parsed.integrity.valid, true);
    assert.equal(parsed.summary.totalEvents, 1);
    assert.equal(parsed.summary.blocked, 1);
    assert.equal(parsed.events[0].resources[0], "<stateDir>/canary.txt");

    const ocsfExport = exportEventsOcsf("replay-sess-1");
    assert.match(ocsfExport, /Application Security Finding/);
    assert.match(ocsfExport, /replay-sess-1/);
    assert.ok(!ocsfExport.includes(tmpDir), "OCSF export should redact state directory paths");
  } finally {
    if (prevHome === undefined) delete process.env.CANARYWATCH_HOME;
    else process.env.CANARYWATCH_HOME = prevHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("events --verify and export --session <id> --format json redact paths and secrets", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-evidence-"));
  const workspace = path.join(tmpDir, "repo");
  const stateDir = path.join(tmpDir, "state");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  const prevHome = process.env.CANARYWATCH_HOME;
  process.env.CANARYWATCH_HOME = stateDir;

  try {
    const fakeSecretPath = "C:\\Users\\alice\\projects\\acme\\.env";
    const fakeToken = "sk-proj-123456789012345678901234567890";
    appendEvent({
      action: "pause",
      detector: "D2",
      reason: `Sensitive-path access: read on ${fakeSecretPath} with token=${fakeToken}`,
      evidence: {
        sessionId: "cw-7f2a",
        tool: "Read",
        paths: [fakeSecretPath, path.join(workspace, ".env")],
        ts: Date.now(),
      },
    });

    const eventsRes = spawnSync(
      process.execPath,
      [path.resolve("src/cli/cli.ts"), "events", "--verify", "--session", "cw-7f2a"],
      {
        cwd: workspace,
        env: { ...process.env, CANARYWATCH_HOME: stateDir },
        encoding: "utf8",
      }
    );
    assert.equal(eventsRes.status, 0, eventsRes.stderr);
    assert.match(eventsRes.stdout, /DENIED · session paused/);
    assert.match(eventsRes.stdout, /D2 · sensitive path/);
    assert.match(eventsRes.stdout, /Hash chain verified/);
    assert.match(eventsRes.stdout, /canarywatch export --session cw-7f2a --format json/);
    assert.ok(!eventsRes.stdout.includes("alice"), "Should redact user name from paths");
    assert.ok(!eventsRes.stdout.includes(fakeToken), "Should redact secret tokens");

    const outPath = path.join(tmpDir, "evidence.json");
    const exportRes = spawnSync(
      process.execPath,
      [
        path.resolve("src/cli/cli.ts"),
        "export",
        "--session",
        "cw-7f2a",
        "--format",
        "json",
        "--workspace",
        workspace,
        "--out",
        outPath,
      ],
      {
        cwd: workspace,
        env: { ...process.env, CANARYWATCH_HOME: stateDir },
        encoding: "utf8",
      }
    );
    assert.equal(exportRes.status, 0, exportRes.stderr);
    const exportedText = fs.readFileSync(outPath, "utf8");
    assert.ok(!exportedText.includes("alice"), "Exported JSON must not contain user name");
    assert.ok(!exportedText.includes(fakeToken), "Exported JSON must not contain API key");
    assert.ok(!exportedText.includes(workspace), "Exported JSON must redact workspace prefix");
    const exported = JSON.parse(exportedText);
    assert.equal(exported.sessionId, "cw-7f2a");
    assert.equal(exported.integrity.valid, true);
    assert.equal(exported.events[0].resources[0], "~/projects/acme/.env");
    assert.equal(exported.events[0].resources[1], "<workspace>/.env");
  } finally {
    if (prevHome === undefined) delete process.env.CANARYWATCH_HOME;
    else process.env.CANARYWATCH_HOME = prevHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
