// Seeds/unseeds canary decoys into a workspace and registers them in the
// signed manifest. docs/PRD.md R1-R6.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  addManifestEntry,
  loadManifest,
  loadOrCreateKey,
  removeManifestEntriesForWorkspace,
  saveManifest,
} from "../core/manifest.ts";
import { canonicalize } from "../core/canonicalize.ts";
import { templatesForDensity } from "./templates.ts";
import type { ManifestEntry } from "../core/types.ts";

export type Density = "light" | "standard" | "paranoid";

export interface SeedResult {
  seeded: ManifestEntry[];
  skipped: string[]; // paths that already existed as real files — never overwritten
}

const GITIGNORE_MARKER = "# canarywatch decoys — do not remove (managed by `canarywatch seed`)";

export function seed(workspaceRoot: string, density: Density = "standard"): SeedResult {
  const root = canonicalize(workspaceRoot);
  const key = loadOrCreateKey();
  const manifest = loadManifest();
  const templates = templatesForDensity(density);

  const seeded: ManifestEntry[] = [];
  const skipped: string[] = [];
  const gitignoreLines: string[] = [];

  for (const tpl of templates) {
    const target = path.join(root, tpl.relativePath);
    if (fs.existsSync(target)) {
      skipped.push(target); // R5: never overwrite an existing real file
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // The token embedded in file contents is independent of the
    // manifest's own per-entry tokenId (which addManifestEntry assigns) —
    // both are per-install-unique, this one just needs to be plausible
    // credential-shaped text.
    const contentToken = crypto.randomBytes(16).toString("hex");
    const text = tpl.render(contentToken);
    fs.writeFileSync(target, text, { mode: 0o600 });
    const entry = addManifestEntry(manifest, key, target, root, Buffer.from(text));
    seeded.push(entry);
    gitignoreLines.push("/" + tpl.relativePath.replace(/\\/g, "/"));
  }

  saveManifest(manifest);
  updateGitignore(root, gitignoreLines);

  return { seeded, skipped };
}

export function unseed(workspaceRoot: string): ManifestEntry[] {
  const root = canonicalize(workspaceRoot);
  const manifest = loadManifest();
  const removed = removeManifestEntriesForWorkspace(manifest, root);
  for (const entry of removed) {
    try {
      if (fs.existsSync(entry.path)) fs.unlinkSync(entry.path);
    } catch {
      // best-effort removal
    }
  }
  saveManifest(manifest);
  removeGitignoreMarker(root);
  return removed;
}

function updateGitignore(root: string, lines: string[]): void {
  if (lines.length === 0) return;
  const gi = path.join(root, ".gitignore");
  let existing = "";
  if (fs.existsSync(gi)) existing = fs.readFileSync(gi, "utf8");
  if (existing.includes(GITIGNORE_MARKER)) return; // already managed
  const block = "\n" + GITIGNORE_MARKER + "\n" + lines.join("\n") + "\n";
  fs.writeFileSync(gi, existing + block);
}

function removeGitignoreMarker(root: string): void {
  const gi = path.join(root, ".gitignore");
  if (!fs.existsSync(gi)) return;
  const content = fs.readFileSync(gi, "utf8");
  const markerIdx = content.indexOf(GITIGNORE_MARKER);
  if (markerIdx === -1) return;
  const before = content.slice(0, markerIdx);
  fs.writeFileSync(gi, before.replace(/\n+$/, "\n"));
}
