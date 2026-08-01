import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadSession } from "../src/core/session.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("true cross-process concurrent hook session state updates", async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-prochook-"));
  process.env.CANARYWATCH_HOME = tmpHome;

  const sessionId = "proc-hook-session";
  const N = 10;

  const sessionUrl = pathToFileURL(path.resolve(__dirname, "..", "src", "core", "session.ts")).href;

  const children: Promise<number | null>[] = [];
  for (let i = 0; i < N; i++) {
    const childCode = `
      import { acquireLock, loadSession, saveSession } from "${sessionUrl}";
      const release = acquireLock("${sessionId}");
      try {
        const state = loadSession("${sessionId}");
        state.scopeViolations += 1;
        state.writeTimestamps.push(Date.now() + ${i});
        saveSession(state);
      } finally {
        release();
      }
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", childCode], {
      env: { ...process.env, CANARYWATCH_HOME: tmpHome },
      stdio: "ignore",
    });
    children.push(
      new Promise((resolve) => {
        child.on("exit", (code) => resolve(code));
      })
    );
  }

  const exitCodes = await Promise.all(children);
  for (const code of exitCodes) {
    assert.equal(code, 0, "Child session process must exit with 0");
  }

  const finalState = loadSession(sessionId);
  assert.equal(finalState.scopeViolations, N, `Scope violations count must equal total ${N} concurrent child process increments`);
  assert.equal(finalState.writeTimestamps.length, N, `Write timestamps array must preserve all ${N} entries from child processes`);

  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {}
});
