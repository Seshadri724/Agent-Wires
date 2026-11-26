// Canary manifest: the signed registry of decoy files.
// docs/ARCHITECTURE.md §3.1 — "Manifest itself lives outside the workspace
// so an agent that reads the workspace can't learn the decoy list."

import fs from "node:fs";
import crypto from "node:crypto";
import { keyPath, manifestPath } from "./home.ts";
import { canonicalize } from "./canonicalize.ts";
import type { Manifest, ManifestEntry } from "./types.ts";

const EMPTY_MANIFEST: Manifest = { version: 1, entries: [] };

/** Load (or create) the HMAC key used to sign manifest entries. Mode 0600. */
export function loadOrCreateKey(): Buffer {
  const p = keyPath();
  if (fs.existsSync(p)) {
    const existing = fs.readFileSync(p);
    if (existing.length !== 32) throw new Error("Canary manifest key has an invalid length");
    return existing;
  }
  const key = crypto.randomBytes(32);
  try {
    const fd = fs.openSync(p, "wx", 0o600);
    try {
      fs.writeFileSync(fd, key);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    // Another hook/CLI process may have created the key first. Use the
    // winner's key; never overwrite it with a second random key.
    if (!fs.existsSync(p)) throw err;
    const existing = fs.readFileSync(p);
    if (existing.length !== 32) throw new Error("Canary manifest key has an invalid length");
    return existing;
  }
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    // chmod may be a no-op on some Windows filesystems; ACLs aren't
    // enforced here in v1 (see docs/ROADMAP.md Phase 2 for hardening).
  }
  return key;
}

/** Generate a per-install-unique token embedded in decoy file contents. */
export function generateToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function signEntry(key: Buffer, entry: Omit<ManifestEntry, "hmac">): string {
  const payload = `${entry.path}|${entry.tokenId}|${entry.sha256}|${entry.createdAt}|${entry.workspace}`;
  return crypto.createHmac("sha256", key).update(payload).digest("hex");
}

export function verifyEntry(key: Buffer, entry: ManifestEntry): boolean {
  if (!entry || typeof entry.hmac !== "string" || !/^[a-f0-9]{64}$/i.test(entry.hmac)) return false;
  const expected = signEntry(key, entry);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(entry.hmac));
}

export function loadManifest(options: { requireEntries?: boolean } = {}): Manifest {
  const p = manifestPath();
  if (!fs.existsSync(p)) {
    if (options.requireEntries) throw new Error("Canary manifest is missing");
    return { version: 1, entries: [] };
  }
  const raw = fs.readFileSync(p, "utf8");
  if (raw.trim().length === 0) {
    if (options.requireEntries) throw new Error("Canary manifest is empty");
    return { version: 1, entries: [] };
  }
  const manifest = JSON.parse(raw) as Manifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) {
    throw new Error("Canary manifest has an invalid format");
  }
  if (options.requireEntries && manifest.entries.length === 0) {
    throw new Error("Canary manifest has no registered canaries");
  }
  return manifest;
}

export function saveManifest(manifest: Manifest): void {
  const destination = manifestPath();
  const temporary = `${destination}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  try {
    fs.renameSync(temporary, destination);
  } catch {
    try {
      fs.copyFileSync(temporary, destination);
      fs.unlinkSync(temporary);
    } catch (err) {
      try {
        fs.unlinkSync(temporary);
      } catch {}
      throw err;
    }
  }
  try {
    fs.chmodSync(destination, 0o600);
  } catch {
    // ACLs are not managed in v1 on Windows; report this limitation in docs.
  }
}

export function addManifestEntry(
  manifest: Manifest,
  key: Buffer,
  filePath: string,
  workspace: string,
  contents: Buffer,
  tokenId: string = generateToken()
): ManifestEntry {
  const sha256 = crypto.createHash("sha256").update(contents).digest("hex");
  const base = {
    path: canonicalize(filePath),
    tokenId,
    sha256,
    createdAt: new Date().toISOString(),
    workspace: canonicalize(workspace),
  };
  const hmac = signEntry(key, base);
  const entry: ManifestEntry = { ...base, hmac };
  manifest.entries.push(entry);
  return entry;
}

export function removeManifestEntriesForWorkspace(manifest: Manifest, workspace: string): ManifestEntry[] {
  const ws = canonicalize(workspace);
  const removed = manifest.entries.filter((e) => e.workspace === ws);
  manifest.entries = manifest.entries.filter((e) => e.workspace !== ws);
  return removed;
}

/** Build an O(1) canonical-path lookup set from a manifest, verifying HMACs. */
export function buildManifestPathSet(manifest: Manifest, key: Buffer): Set<string> {
  const set = new Set<string>();
  for (const entry of manifest.entries) {
    if (!verifyEntry(key, entry)) throw new Error(`Canary manifest entry failed verification: ${entry.path}`);
    set.add(entry.path);
  }
  return set;
}

/** Verified honey-tokens embedded in canary files. Used to catch reuse in later tool calls. */
export function buildManifestTokenSet(manifest: Manifest, key: Buffer): Set<string> {
  const set = new Set<string>();
  for (const entry of manifest.entries) {
    if (!verifyEntry(key, entry)) throw new Error(`Canary manifest entry failed verification: ${entry.path}`);
    if (entry.tokenId.length >= 16) set.add(entry.tokenId);
  }
  return set;
}
