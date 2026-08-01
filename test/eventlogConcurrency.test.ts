import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readEvents, verifyChain } from "../src/core/eventlog.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("true cross-process concurrent event log appends", async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-proclog-"));
  process.env.CANARYWATCH_HOME = tmpHome;

  const N = 10;
  const eventlogUrl = pathToFileURL(path.resolve(__dirname, "..", "src", "core", "eventlog.ts")).href;

  const children: Promise<number | null>[] = [];

  for (let i = 0; i < N; i++) {
    const childCode = `
      import { appendEvent } from "${eventlogUrl}";
      appendEvent({
        action: 'log',
        detector: 'none',
        reason: 'Concurrent child event ${i}',
        evidence: { sessionId: 'proc-sess', tool: 'Read', paths: ['file_${i}.txt'], ts: Date.now() }
      });
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
    assert.equal(code, 0, "Child event append process must exit with 0");
  }

  const events = readEvents();
  assert.equal(events.length, N, `Event log must contain exactly ${N} entries from ${N} concurrent child processes`);

  const chainResult = verifyChain();
  assert.equal(chainResult.valid, true, `Hash chain must remain valid after cross-process concurrent appends: ${chainResult.reason}`);

  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {}
});
