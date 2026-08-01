// Resolves canarywatch's own state directory. Kept out of the workspace
// on purpose (docs/ARCHITECTURE.md §3.1, §6) so an agent reading the
// workspace cannot enumerate the decoy list.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export function canarywatchHome(): string {
  const override = process.env.CANARYWATCH_HOME;
  const home = override && override.length > 0 ? override : path.join(os.homedir(), ".canarywatch");
  fs.mkdirSync(home, { recursive: true });
  return home;
}

export function keyPath(): string {
  return path.join(canarywatchHome(), "key");
}

export function manifestPath(): string {
  return path.join(canarywatchHome(), "manifest.json");
}

export function policyPath(): string {
  return path.join(canarywatchHome(), "policy.json");
}

export function eventLogPath(): string {
  return path.join(canarywatchHome(), "events.jsonl");
}

export function sessionsDir(): string {
  const dir = path.join(canarywatchHome(), "sessions");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function scopeFileFor(workspace: string): string {
  // Scope declarations live in the workspace state dir, not the manifest
  // (they're not secret and the user edits them directly).
  return path.join(canarywatchHome(), "scopes", encodeURIComponent(workspace) + ".json");
}
