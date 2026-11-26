import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../src/core/canonicalize.ts";
import { loadOrCreateKey, saveManifest } from "../src/core/manifest.ts";
import { DEFAULT_POLICY } from "../src/core/types.ts";
import { savePolicy } from "../src/core/config.ts";
import { readEvents } from "../src/core/eventlog.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("MCP Proxy true child-process integration test", async (t) => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-test-mcpproc-"));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "canarywatch-ws-"));
  const previousHome = process.env.CANARYWATCH_HOME;
  process.env.CANARYWATCH_HOME = tmpHome;
  let proxyProcess: ReturnType<typeof spawn> | undefined;
  let blockedProxyProcess: ReturnType<typeof spawn> | undefined;
  const stop = (child: ReturnType<typeof spawn> | undefined) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      child.kill();
    });
  };
  t.after(async () => {
    await Promise.all([stop(proxyProcess), stop(blockedProxyProcess)]);
    if (previousHome === undefined) delete process.env.CANARYWATCH_HOME;
    else process.env.CANARYWATCH_HOME = previousHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

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
  savePolicy({
    ...DEFAULT_POLICY,
    mcp: { ...DEFAULT_POLICY.mcp, blockedServers: ["blocked-test-server"] },
  });

  const cliPath = path.resolve(__dirname, "..", "src", "cli", "cli.ts");
  const echoScript = "process.stdin.setEncoding('utf8'); process.stdin.on('data', d => process.stdout.write(d));";

  proxyProcess = spawn(
    process.execPath,
    [cliPath, "mcp-proxy", "--session=mcp-proc-test", "--cwd=" + workspace, process.execPath, "-e", echoScript],
    {
      env: { ...process.env, CANARYWATCH_HOME: tmpHome },
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  let outputBuffer = "";
  proxyProcess.stdout!.setEncoding("utf8");
  proxyProcess.stdout!.on("data", (chunk) => {
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
  proxyProcess.stdin!.write(safeReq);

  const res1 = await waitForResponse(1);
  assert.equal(res1.id, 1);
  assert.equal(res1.error, undefined, "Safe call must be forwarded without proxy error");

  // 2. Send malformed line (proxy must survive)
  proxyProcess.stdin!.write("INVALID JSON LINE\n");

  // 3. Send canary MCP tool request
  const canaryReq = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "Read", arguments: { file_path: canaryPath } },
  }) + "\n";
  proxyProcess.stdin!.write(canaryReq);

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
  proxyProcess.stdin!.write(followUpReq);

  const res3 = await waitForResponse(3);
  assert.equal(res3.id, 3);
  assert.ok(res3.error, "Follow-up request on locked session must produce error");
  assert.match(res3.error.message, /Session is locked/);

  const blockedEcho = "process.stdin.setEncoding('utf8'); process.stdin.on('data', d => process.stdout.write(d));";
  blockedProxyProcess = spawn(
    process.execPath,
    [cliPath, "mcp-proxy", "--session=mcp-proxy-blocked", "--cwd=" + workspace, "--server=blocked-test-server", process.execPath, "-e", blockedEcho],
    { env: { ...process.env, CANARYWATCH_HOME: tmpHome }, stdio: ["pipe", "pipe", "pipe"] }
  );
  let blockedOutput = "";
  blockedProxyProcess.stdout!.setEncoding("utf8");
  blockedProxyProcess.stdout!.on("data", (chunk) => { blockedOutput += chunk; });
  function waitForBlockedResponse(id: number, timeoutMs = 3000): Promise<any> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        for (const line of blockedOutput.split("\n")) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === id) return resolve(parsed);
          } catch {}
        }
        if (Date.now() - start > timeoutMs) return reject(new Error(`Timeout waiting for blocked proxy response ${id}: ${blockedOutput}`));
        setTimeout(check, 50);
      };
      check();
    });
  }

  blockedProxyProcess.stdin!.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "Read", arguments: { file_path: "normal.txt" } },
  }) + "\n");
  const blockedResponse = await waitForBlockedResponse(4);
  assert.equal(blockedResponse.error?.code, -32600);
  assert.match(blockedResponse.error.message, /Action denied \(D6\)/);
  assert.ok(
    readEvents().some((event) => event.decision.evidence.sessionId === "mcp-proxy-blocked" && event.decision.detector === "D6"),
    "The blocked proxy call should be recorded as D6"
  );

  blockedProxyProcess.stdin!.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "Read", arguments: { file_path: "normal.txt" } },
  }) + "\n");
  const blockedFollowUp = await waitForBlockedResponse(5);
  assert.match(blockedFollowUp.error.message, /Session is locked/);
});
