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
    return fs.readFileSync(p);
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(p, key, { mode: 0o600 });
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
  const expected = signEntry(key, entry);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(entry.hmac));
}

export function loadManifest(): Manifest {
  const p = manifestPath();
  if (!fs.existsSync(p)) return { ...EMPTY_MANIFEST };
  const raw = fs.readFileSync(p, "utf8");
  if (raw.trim().length === 0) return { ...EMPTY_MANIFEST };
  return JSON.parse(raw) as Manifest;
}

export function saveManifest(manifest: Manifest): void {
  fs.writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2), { mode: 0o600 });
}

export function addManifestEntry(
  manifest: Manifest,
  key: Buffer,
  filePath: string,
  workspace: string,
  contents: Buffer
): ManifestEntry {
  const tokenId = generateToken();
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
    if (!verifyEntry(key, entry)) {
      // Tampered entry — do not trust it as a canary, but this is itself
      // worth surfacing (see docs/ARCHITECTURE.md §6). Callers may log this.
      continue;
    }
    set.add(entry.path);
  }
  return set;
}
