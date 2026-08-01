import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../src/core/canonicalize.ts";
import { loadOrCreateKey, saveManifest } from "../src/core/manifest.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("MCP Proxy true child-process integration test", async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-mcpproc-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-ws-"));
  process.env.CANARYWATCH_HOME = tmpHome;

  const canaryPath = canonicalize(path.join(workspace, "canary.txt"));
  fs.writeFileSync(canaryPath, "canary secret token\n");

  // Seed canary in manifest
  const key = loadOrCreateKey();
  const manifest = {
    version: 1 as const,
    entries: [
      {
        path: canaryPath,
        tokenId: "tok123",
        sha256: "dummy",
        createdAt: new Date().toISOString(),
        hmac: "",
        workspace: canonicalize(workspace),
      },
    ],
  };
  // Compute HMAC
  const entry = manifest.entries[0];
  const payload = `${entry.path}|${entry.tokenId}|${entry.sha256}|${entry.createdAt}|${entry.workspace}`;
  entry.hmac = (await import("node:crypto")).createHmac("sha256", key).update(payload).digest("hex");
  saveManifest(manifest);

  const cliPath = path.resolve(__dirname, "..", "src", "cli", "cli.ts");
  const echoScript = "process.stdin.setEncoding('utf8'); process.stdin.on('data', d => process.stdout.write(d));";

  const proxyProcess = spawn(
    process.execPath,
    [cliPath, "mcp-proxy", "--session=mcp-proc-test", "--cwd=" + workspace, process.execPath, "-e", echoScript],
    {
      env: { ...process.env, CANARYWATCH_HOME: tmpHome },
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  let outputBuffer = "";
  proxyProcess.stdout.setEncoding("utf8");
  proxyProcess.stdout.on("data", (chunk) => {
    outputBuffer += chunk;
  });

  function waitForResponse(id: number, timeoutMs = 3000): Promise<any> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const lines = outputBuffer.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === id) return resolve(parsed);
          } catch {}
        }
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`Timeout waiting for response id ${id}. Received buffer: ${outputBuffer}`));
        }
        setTimeout(check, 50);
      };
      check();
    });
  }

  // 1. Send safe MCP tool request
  const safeReq = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "Read", arguments: { file_path: "normal.txt" } },
  }) + "\n";
  proxyProcess.stdin.write(safeReq);

  const res1 = await waitForResponse(1);
  assert.equal(res1.id, 1);
  assert.equal(res1.error, undefined, "Safe call must be forwarded without proxy error");

  // 2. Send malformed line (proxy must survive)
  proxyProcess.stdin.write("INVALID JSON LINE\n");

  // 3. Send canary MCP tool request
  const canaryReq = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "Read", arguments: { file_path: canaryPath } },
  }) + "\n";
  proxyProcess.stdin.write(canaryReq);

  const res2 = await waitForResponse(2);
  assert.equal(res2.id, 2);
  assert.ok(res2.error, "Canary access must produce JSON-RPC error");
  assert.equal(res2.error.code, -32600);
  assert.match(res2.error.message, /Action denied \(D1\)/);

  // 4. Send follow-up safe request (session must now be locked)
  const followUpReq = JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "Read", arguments: { file_path: "normal.txt" } },
  }) + "\n";
  proxyProcess.stdin.write(followUpReq);

  const res3 = await waitForResponse(3);
  assert.equal(res3.id, 3);
  assert.ok(res3.error, "Follow-up request on locked session must produce error");
  assert.match(res3.error.message, /Session is locked/);

  proxyProcess.kill();
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  } catch {}
});
