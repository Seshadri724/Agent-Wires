import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cw-manifest-home-"));
  process.env.CANARYWATCH_HOME = tmpHome;
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.CANARYWATCH_HOME;
});

describe("manifest sign/verify", () => {
  test("a freshly added entry verifies", async () => {
    const { loadOrCreateKey } = await import("../src/core/manifest.ts");
    const { addManifestEntry, buildManifestPathSet, loadManifest, saveManifest } = await import(
      "../src/core/manifest.ts"
    );
    const key = loadOrCreateKey();
    const manifest = loadManifest();
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "cw-manifest-ws-"));
    const filePath = path.join(ws, "decoy.txt");
    fs.writeFileSync(filePath, "hello");

    const entry = addManifestEntry(manifest, key, filePath, ws, Buffer.from("hello"));
    saveManifest(manifest);

    const reloaded = loadManifest();
    const pathSet = buildManifestPathSet(reloaded, key);
    assert.ok(pathSet.has(entry.path), "verified entry should be in the path set");

    fs.rmSync(ws, { recursive: true, force: true });
  });

  test("a tampered entry (wrong hmac) fails manifest verification", async () => {
    const { loadOrCreateKey, addManifestEntry, buildManifestPathSet, loadManifest, saveManifest } = await import(
      "../src/core/manifest.ts"
    );
    const key = loadOrCreateKey();
    const manifest = loadManifest();
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "cw-manifest-ws-"));
    const filePath = path.join(ws, "decoy.txt");
    fs.writeFileSync(filePath, "hello");

    const entry = addManifestEntry(manifest, key, filePath, ws, Buffer.from("hello"));
    entry.hmac = "0".repeat(64); // tamper
    saveManifest(manifest);

    const reloaded = loadManifest();
    assert.throws(() => buildManifestPathSet(reloaded, key), /failed verification/);

    fs.rmSync(ws, { recursive: true, force: true });
  });

  test("enforcement mode rejects missing and empty manifests", async () => {
    const { loadManifest, saveManifest } = await import("../src/core/manifest.ts");
    assert.throws(() => loadManifest({ requireEntries: true }), /missing/);
    saveManifest({ version: 1, entries: [] });
    assert.throws(() => loadManifest({ requireEntries: true }), /no registered canaries/);
  });

  test("verification fails against a different key", async () => {
    const { generateToken, signEntry, verifyEntry } = await import("../src/core/manifest.ts");
    const crypto = await import("node:crypto");
    const key1 = crypto.randomBytes(32);
    const key2 = crypto.randomBytes(32);
    const base = {
      path: "/tmp/x",
      tokenId: generateToken(),
      sha256: "abc",
      createdAt: new Date().toISOString(),
      workspace: "/tmp",
    };
    const hmac = signEntry(key1, base);
    assert.equal(verifyEntry(key1, { ...base, hmac }), true);
    assert.equal(verifyEntry(key2, { ...base, hmac }), false);
  });
});
